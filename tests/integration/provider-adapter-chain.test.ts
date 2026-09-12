import { Socket } from "node:net";
import {
  type BaselineStats,
  buildAlertEligibilityService,
  buildAlertFingerprint,
  buildOfferFingerprint,
  buildScoringService,
  buildTravelRulesService,
  DEFAULT_ALERT_TEMPLATE_VERSION,
  Money,
  type ProviderOfferInput,
  toNormalizedOffer,
} from "@lowroute/domain";
import {
  alertsRepository,
  baselinesRepository,
  getPool,
  offersRepository,
} from "@lowroute/persistence";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/lowroute";
const ROUTE_KEY = "EZE-MAD";
const TELEGRAM_CHAT_ID = "-100-test";
const COOLDOWN_HOURS = 24;
const MAX_LAYOVER_HOURS = 8;

const parseTcpTarget = (databaseUrl: string): { host: string; port: number } | null => {
  try {
    const url = new URL(databaseUrl);
    return { host: url.hostname || "localhost", port: Number(url.port) || 5432 };
  } catch {
    return null;
  }
};

const checkTcp = (host: string, port: number, timeoutMs = 1500): Promise<boolean> =>
  new Promise((resolve) => {
    const socket = new Socket();
    const done = (ok: boolean): void => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
    socket.connect(port, host);
  });

const tcpTarget = parseTcpTarget(DATABASE_URL);
const dbReachable = tcpTarget ? await checkTcp(tcpTarget.host, tcpTarget.port) : false;

if (!dbReachable) {
  const target = tcpTarget ? `${tcpTarget.host}:${tcpTarget.port}` : "invalid DATABASE_URL";
  process.stdout.write(
    `[integration] Postgres unreachable (${target}), skipping pg-backed tests. ` +
      "Run: docker compose up -d postgres && pnpm migrate:up && pnpm test:integration\n",
  );
}

const stubRisk = {
  self_transfer: false,
  separate_tickets: false,
  airport_change: false,
  overnight_layover: false,
  checked_bag_included: false,
  carry_on_included: true,
  connection_minutes_min: 60,
};

const stubDeal: ProviderOfferInput = {
  provider: "duffel",
  origin: "EZE",
  destination: "MAD",
  departure_date: "2026-10-01",
  return_date: "2026-10-15",
  merchant_country: "US",
  currency: "USD",
  quoted_amount: 500,
  risk: stubRisk,
};

// ! Mirrors fetchOffers.toDomainOffers: one bad quote must not fail the batch.
// ! Rules service is built once per batch from the search cap, same as production.
const rules = buildTravelRulesService({ MAX_LAYOVER_HOURS });
const toDomainOffers = (
  offers: readonly ProviderOfferInput[],
): ReturnType<typeof toNormalizedOffer>[] =>
  offers.map((offer) => {
    try {
      return toNormalizedOffer(offer, { maxLayoverHours: MAX_LAYOVER_HOURS }, rules);
    } catch {
      return null;
    }
  });

const cleanupRoute = async (): Promise<void> => {
  const pool = getPool();
  try {
    await pool.query(
      "delete from sent_alerts where offer_fingerprint in (select offer_fingerprint from offers where origin = 'EZE' and destination = 'MAD')",
    );
    await pool.query("delete from offers where origin = 'EZE' and destination = 'MAD'");
    await pool.query("delete from route_baselines where route_key = $1", [ROUTE_KEY]);
  } catch (error) {
    if ((error as { code?: string }).code === "42P01") {
      throw new Error(
        "integration tables missing: run `pnpm migrate:up` against DATABASE_URL, " +
          "then `pnpm test:integration`",
      );
    }
    throw error;
  }
};

describe.skipIf(!dbReachable)(
  "stubbed provider offers -> adapter -> score -> persist -> suppress (pg)",
  () => {
    beforeAll(async () => {
      await cleanupRoute();
    });

    afterAll(async () => {
      try {
        await cleanupRoute();
      } finally {
        await getPool().end();
      }
    });

    it("scores an adapted deal, persists it, and suppresses resend within cooldown", async () => {
      // Stubbed provider batch: one deal, one over the layover cap, one malformed quote.
      const [deal, overCap, malformed] = toDomainOffers([
        stubDeal,
        { ...stubDeal, risk: { ...stubRisk, connection_minutes_min: 481 } },
        { ...stubDeal, currency: "XX", quoted_amount: 100 },
      ]);
      expect(deal).not.toBeNull();
      expect(overCap).toBeNull();
      expect(malformed).toBeNull();
      if (!deal) {
        throw new Error("stubbed deal must survive toNormalizedOffer");
      }

      // Score: rank stamps score = -payable for a clean itinerary.
      const [scored] = buildScoringService().rank([deal]);
      expect(scored.score).toBe(-500);

      // Select: deal beats the route baseline; a pricey offer does not.
      await baselinesRepository.upsert({
        route_key: ROUTE_KEY,
        p20: Money.fromDecimal(600, "USD"),
        median: Money.fromDecimal(800, "USD"),
        sample_size: 24,
      });
      const baseline = (await baselinesRepository.getByRoute(ROUTE_KEY)) as BaselineStats | null;
      expect(baseline).not.toBeNull();
      if (!baseline) {
        throw new Error("baseline must roundtrip before selection");
      }
      const eligibility = buildAlertEligibilityService({
        DEAL_PERCENTILE_THRESHOLD: 0.2,
        DEAL_DISCOUNT_PCT: undefined,
      });
      expect(eligibility.shouldAlert(scored, baseline)).toBe(true);

      const delivery = {
        telegramChatId: TELEGRAM_CHAT_ID,
        alertCooldownHours: COOLDOWN_HOURS,
        wasSentRecently: alertsRepository.wasSentRecently,
      };
      expect(await eligibility.shouldAlertForDelivery(scored, baseline, delivery)).toBe(true);

      // Persist the scored deal; prove the row landed.
      await offersRepository.upsert(scored);
      const offerFp = buildOfferFingerprint(scored);
      const selected = await getPool().query(
        `select offer_fingerprint, provider, origin, destination, normalized_payable_usd
       from offers where offer_fingerprint = $1`,
        [offerFp],
      );
      expect(selected.rowCount).toBe(1);
      expect(selected.rows[0].provider).toBe("duffel");
      expect(Number(selected.rows[0].normalized_payable_usd)).toBe(500);

      // Send-suppress: markSent after delivery, resend stays suppressed within cooldown.
      const alertFp = buildAlertFingerprint(
        offerFp,
        TELEGRAM_CHAT_ID,
        DEFAULT_ALERT_TEMPLATE_VERSION,
      );
      await alertsRepository.markSent(alertFp, offerFp);
      expect(await alertsRepository.wasSentRecently(alertFp, COOLDOWN_HOURS)).toBe(true);
      expect(await eligibility.shouldAlertForDelivery(scored, baseline, delivery)).toBe(false);
    });
  },
);
