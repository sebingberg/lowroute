import { Socket } from "node:net";
import {
  type BaselineStats,
  buildAlertEligibilityService,
  buildAlertFingerprint,
  buildOfferFingerprint,
  DEFAULT_ALERT_TEMPLATE_VERSION,
  Money,
  type NormalizedOffer,
} from "@lowroute/domain";
import {
  alertsRepository,
  baselinesRepository,
  getPool,
  offersRepository,
} from "@lowroute/persistence";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { alertsHandler } from "../../apps/service/src/http/alerts.js";
import { offersHandler } from "../../apps/service/src/http/offers.js";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/lowroute";
const ROUTE_KEY = "EZE-TST";
const TELEGRAM_CHAT_ID = "-100-test";
const COOLDOWN_HOURS = 24;

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

const buildOffer = (overrides?: {
  quotedUsd?: number;
  payableUsd?: number;
  connectionMinutes?: number;
}): NormalizedOffer => ({
  provider: "duffel",
  origin: "EZE",
  destination: "TST",
  departure_date: "2026-10-10",
  return_date: "2026-11-01",
  trip_days: 22,
  destination_tier: "far",
  cabin: "economy",
  max_layover_hours: 4,
  self_transfer: false,
  separate_tickets: false,
  airport_change: false,
  overnight_layover: false,
  checked_bag_included: false,
  carry_on_included: true,
  connection_minutes_min: overrides?.connectionMinutes ?? 100,
  merchant_country: "US",
  quoted_price: Money.fromDecimal(overrides?.quotedUsd ?? 550, "USD"),
  normalized_payable: Money.fromDecimal(overrides?.payableUsd ?? 550, "USD"),
  payment_path: "foreign_card",
  score: 900,
});

const buildBaseline = (overrides?: { p20?: number; median?: number; sampleSize?: number }) => ({
  route_key: ROUTE_KEY,
  p20: Money.fromDecimal(overrides?.p20 ?? 600, "USD"),
  median: Money.fromDecimal(overrides?.median ?? 800, "USD"),
  sample_size: overrides?.sampleSize ?? 24,
});

const stubContext = (query: Record<string, string | undefined>) =>
  ({
    req: { query: (key: string) => query[key] },
    json: (payload: unknown) => Response.json(payload),
  }) as unknown as Parameters<typeof offersHandler>[0];

const cleanup = async (offerFingerprints: string[]): Promise<void> => {
  const pool = getPool();
  try {
    await pool.query("delete from sent_alerts where offer_fingerprint = any($1)", [
      offerFingerprints,
    ]);
    await pool.query("delete from offers where offer_fingerprint = any($1)", [offerFingerprints]);
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

describe.skipIf(!dbReachable)("persist -> select -> send-suppress (pg)", () => {
  const primaryOffer = buildOffer();
  const primaryOfferFp = buildOfferFingerprint(primaryOffer);
  const primaryAlertFp = buildAlertFingerprint(
    primaryOfferFp,
    TELEGRAM_CHAT_ID,
    DEFAULT_ALERT_TEMPLATE_VERSION,
  );
  const chainOffer = buildOffer({ connectionMinutes: 101 });
  const chainOfferFp = buildOfferFingerprint(chainOffer);
  const chainAlertFp = buildAlertFingerprint(
    chainOfferFp,
    TELEGRAM_CHAT_ID,
    DEFAULT_ALERT_TEMPLATE_VERSION,
  );

  beforeAll(async () => {
    await cleanup([primaryOfferFp, chainOfferFp]);
  });

  afterAll(async () => {
    await cleanup([primaryOfferFp, chainOfferFp]);
    await getPool().end();
  });

  it("upserts an offer, reads it back, and stays idempotent on repeat upserts", async () => {
    await offersRepository.upsert(primaryOffer);

    const selected = await getPool().query(
      `select offer_fingerprint, provider, origin, destination,
        normalized_payable_usd, quoted_amount
       from offers where offer_fingerprint = $1`,
      [primaryOfferFp],
    );
    expect(selected.rowCount).toBe(1);
    expect(selected.rows[0].provider).toBe("duffel");
    expect(Number(selected.rows[0].normalized_payable_usd)).toBe(550);

    await offersRepository.upsert(primaryOffer);
    const recount = await getPool().query(
      "select count(*)::int as n from offers where offer_fingerprint = $1",
      [primaryOfferFp],
    );
    expect(recount.rows[0].n).toBe(1);

    // quoted_price is outside the offer fingerprint, so a repriced upsert
    // keeps the fingerprint and updates the row instead of duplicating it.
    const repriced = buildOffer({ quotedUsd: 560 });
    expect(buildOfferFingerprint(repriced)).toBe(primaryOfferFp);
    await offersRepository.upsert(repriced);
    const updated = await getPool().query(
      "select quoted_amount, normalized_payable_usd from offers where offer_fingerprint = $1",
      [primaryOfferFp],
    );
    expect(Number(updated.rows[0].quoted_amount)).toBe(560);
    expect(Number(updated.rows[0].normalized_payable_usd)).toBe(550);
    const recountAfterReprice = await getPool().query(
      "select count(*)::int as n from offers where offer_fingerprint = $1",
      [primaryOfferFp],
    );
    expect(recountAfterReprice.rows[0].n).toBe(1);
  });

  it("roundtrips route baselines on write -> read", async () => {
    expect(await baselinesRepository.getByRoute("NOPE-XXX")).toBeNull();

    await baselinesRepository.upsert(buildBaseline());
    const baseline = (await baselinesRepository.getByRoute(ROUTE_KEY)) as BaselineStats | null;
    expect(baseline?.route_key).toBe(ROUTE_KEY);
    expect(baseline?.p20.amount).toBe(600);
    expect(baseline?.median.amount).toBe(800);
    expect(baseline?.sample_size).toBe(24);

    await baselinesRepository.upsert(buildBaseline({ p20: 590, sampleSize: 25 }));
    const refreshed = (await baselinesRepository.getByRoute(ROUTE_KEY)) as BaselineStats | null;
    expect(refreshed?.p20.amount).toBe(590);
    expect(refreshed?.sample_size).toBe(25);
  });

  it("marks alerts sent, suppresses within cooldown, and allows after expiry", async () => {
    await offersRepository.upsert(primaryOffer);

    expect(await alertsRepository.wasSentRecently(primaryAlertFp, COOLDOWN_HOURS)).toBe(false);

    await alertsRepository.markSent(primaryAlertFp, primaryOfferFp);
    expect(await alertsRepository.wasSentRecently(primaryAlertFp, COOLDOWN_HOURS)).toBe(true);

    await alertsRepository.markSent(primaryAlertFp, primaryOfferFp);
    const recount = await getPool().query(
      "select count(*)::int as n from sent_alerts where alert_fingerprint = $1",
      [primaryAlertFp],
    );
    expect(recount.rows[0].n).toBe(1);

    await getPool().query(
      `update sent_alerts set sent_at_utc = now() - ($2 || ' hours')::interval
       where alert_fingerprint = $1`,
      [primaryAlertFp, String(COOLDOWN_HOURS + 1)],
    );
    expect(await alertsRepository.wasSentRecently(primaryAlertFp, COOLDOWN_HOURS)).toBe(false);
  });

  it("drives the persist -> select -> send-suppress chain", async () => {
    await baselinesRepository.upsert(buildBaseline());
    const baseline = await baselinesRepository.getByRoute(ROUTE_KEY);
    expect(baseline).not.toBeNull();

    const eligibility = buildAlertEligibilityService({
      DEAL_PERCENTILE_THRESHOLD: 0.2,
      DEAL_DISCOUNT_PCT: undefined,
    });
    expect(eligibility.shouldAlert(chainOffer, baseline)).toBe(true);

    const delivery = {
      telegramChatId: TELEGRAM_CHAT_ID,
      alertCooldownHours: COOLDOWN_HOURS,
      wasSentRecently: alertsRepository.wasSentRecently,
    };
    expect(await eligibility.shouldAlertForDelivery(chainOffer, baseline, delivery)).toBe(true);

    // Same ordering as sendAlerts: persist before send, markSent only after success.
    await offersRepository.upsert(chainOffer);
    const delivered = true;
    if (delivered) {
      await alertsRepository.markSent(chainAlertFp, chainOfferFp);
    }

    expect(await eligibility.shouldAlertForDelivery(chainOffer, baseline, delivery)).toBe(false);
  });

  it("exposes persisted rows via the offers/alerts HTTP handlers", async () => {
    await offersRepository.upsert(primaryOffer);
    await alertsRepository.markSent(primaryAlertFp, primaryOfferFp);

    const offersResponse = await offersHandler(stubContext({ origin: "eze", destination: "tst" }));
    const offersBody = (await offersResponse.json()) as {
      offers: Array<{ offer_fingerprint: string }>;
      count: number;
    };
    expect(offersBody.offers.map((row) => row.offer_fingerprint)).toContain(primaryOfferFp);

    const alertsResponse = await alertsHandler(
      stubContext({}) as unknown as Parameters<typeof alertsHandler>[0],
    );
    const alertsBody = (await alertsResponse.json()) as {
      alerts: Array<{ alert_fingerprint: string }>;
      count: number;
    };
    expect(alertsBody.alerts.map((row) => row.alert_fingerprint)).toContain(primaryAlertFp);
  });
});
