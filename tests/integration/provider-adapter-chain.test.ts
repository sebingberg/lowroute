import { Socket } from "node:net";
import {
  type BaselineStats,
  buildAlertEligibilityService,
  buildAlertFingerprint,
  buildOfferFingerprint,
  buildScoringService,
  DEFAULT_ALERT_TEMPLATE_VERSION,
  Money,
} from "@lowroute/domain";
import {
  alertsRepository,
  baselinesRepository,
  getPool,
  offersRepository,
} from "@lowroute/persistence";
import type {
  NormalizedProviderOffer,
  ProviderName,
  ProviderProbe,
} from "@lowroute/providers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { fetchOffers } from "../../apps/service/src/jobs/fetch-offers.js";

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

const search = {
  origin: "EZE",
  destination: "MAD",
  departure_date: "2026-10-01",
  return_date: "2026-10-15",
  cabin: "economy" as const,
  adults: 1 as const,
  max_layover_hours: MAX_LAYOVER_HOURS,
};

const stubEnv = {
  DUFFEL_API_KEY: "test-duffel-key",
  KIWI_API_KEY: "test-kiwi-key",
  TRAVELPAYOUTS_TOKEN: "test-tp-token",
};

const stubOffer = (
  id: string,
  overrides: Partial<NormalizedProviderOffer> = {},
): NormalizedProviderOffer => ({
  provider: "duffel",
  id,
  origin: search.origin,
  destination: search.destination,
  departure_date: search.departure_date,
  return_date: search.return_date,
  merchant_country: "US",
  currency: "USD",
  quoted_amount: 500,
  risk: {
    self_transfer: false,
    separate_tickets: false,
    airport_change: false,
    overnight_layover: false,
    checked_bag_included: false,
    carry_on_included: true,
    connection_minutes_min: 60,
  },
  raw_ref: `duffel:test:${id}`,
  ...overrides,
});

// ! Stubbed provider batch goes through the production fetchOffers wiring
// ! (probe fan-out + provider->domain adapter) with injected stub probes:
// ! one deal, one long-minimum-connection offer, one malformed quote.
const stubProbes: Readonly<Record<ProviderName, ProviderProbe>> = {
  duffel: {
    run: async (request) => ({
      provider: "duffel",
      searched_at_utc: "2026-09-12T00:00:00.000Z",
      request,
      offers: [
        stubOffer("d1"),
        stubOffer("d-long", {
          quoted_amount: 450,
          risk: {
            self_transfer: false,
            separate_tickets: false,
            airport_change: false,
            overnight_layover: false,
            checked_bag_included: false,
            carry_on_included: true,
            connection_minutes_min: 481,
          },
        }),
        stubOffer("d-bad", { currency: "XX", quoted_amount: 100 }),
      ],
    }),
  },
  kiwi: {
    run: async (request) => ({
      provider: "kiwi",
      searched_at_utc: "2026-09-12T00:00:00.000Z",
      request,
      offers: [],
    }),
  },
  travelpayouts: {
    run: async (request) => ({
      provider: "travelpayouts",
      searched_at_utc: "2026-09-12T00:00:00.000Z",
      request,
      offers: [],
    }),
  },
};

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
      const { offers, errors } = await fetchOffers(
        { search },
        { probes: stubProbes, env: stubEnv },
      );
      expect(errors).toEqual([]);
      // ! The 481-minute minimum survives: connection_minutes_min is the
      // ! SHORTEST connection and the layover cap is enforced probe-side
      // ! (exceedsLayoverCap), which stub probes bypass. Only the malformed
      // ! quote drops.
      expect(offers).toHaveLength(2);
      const deal = offers.find((offer) => offer.connection_minutes_min === 60);
      if (!deal) {
        throw new Error("stubbed deal must survive fetchOffers");
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
