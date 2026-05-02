import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { discoverCandidates } from "./discover-candidates.js";

const highBudgetEnv = {
  DUFFEL_REQ_LIMIT_PER_RUN: 10_000,
  KIWI_REQ_LIMIT_PER_RUN: 10_000,
  TRAVELPAYOUTS_REQ_LIMIT_PER_RUN: 10_000,
} as const;

// ! Keep this list aligned with packages/config/src/env.ts so tests do not inherit host env.
const hermeticEnvKeys = [
  "NODE_ENV",
  "PORT",
  "LOG_LEVEL",
  "DATABASE_URL",
  "APP_TIMEZONE",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_CHAT_ID",
  "TELEGRAM_ALERTS_ENABLED",
  "ALERT_DRY_RUN",
  "DEFAULT_PAYMENT_PATH",
  "AR_TAX_RULESET_VERSION",
  "FX_RATE_SOURCE",
  "FX_RATE_TTL_HOURS",
  "DEAL_PERCENTILE_THRESHOLD",
  "DEAL_DISCOUNT_PCT",
  "MAX_LAYOVER_HOURS",
  "ALLOWED_ORIGINS",
  "ENABLE_EPA",
  "COVERAGE_THRESHOLD_PCT",
  "COVERAGE_PRICE_TOLERANCE_PCT",
  "COVERAGE_TRIP_DAYS_TOLERANCE",
  "COVERAGE_DEPARTURE_DATE_TOLERANCE_DAYS",
  "COVERAGE_RETURN_DATE_TOLERANCE_DAYS",
  "DUFFEL_REQ_LIMIT_PER_RUN",
  "KIWI_REQ_LIMIT_PER_RUN",
  "TRAVELPAYOUTS_REQ_LIMIT_PER_RUN",
  "PROVIDER_LIMIT_OVERFLOW_BEHAVIOR",
] as const;

const stubHermeticAmbientEnv = (overrides: Record<string, string | undefined> = {}): void => {
  for (const key of hermeticEnvKeys) {
    vi.stubEnv(key, undefined);
  }

  for (const [key, value] of Object.entries(overrides)) {
    vi.stubEnv(key, value);
  }
};

const uniqueValues = <T>(values: T[]): T[] => [...new Set(values)];

describe("discoverCandidates", () => {
  beforeEach(() => {
    stubHermeticAmbientEnv();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("emits deterministic dated candidates and honors EPA flag", () => {
    const candidates = discoverCandidates({
      env: {
        ...highBudgetEnv,
        ALLOWED_ORIGINS: ["EZE", "EPA"],
        ENABLE_EPA: false,
      },
      now: new Date("2026-04-25T00:00:00.000Z"),
    });

    expect(candidates[0]).toMatchObject({
      departure_date: "2026-05-25",
      origin: "EZE",
    });
    expect(candidates.some((candidate) => candidate.origin === "EPA")).toBe(false);
  });

  it("caps candidates by the minimum per-provider per-run limit", () => {
    const now = new Date("2026-04-25T00:00:00.000Z");
    const full = discoverCandidates({
      env: {
        ...highBudgetEnv,
        ALLOWED_ORIGINS: ["EZE"],
        ENABLE_EPA: false,
      },
      now,
    });

    const capped = discoverCandidates({
      env: {
        ALLOWED_ORIGINS: ["EZE"],
        ENABLE_EPA: false,
        DUFFEL_REQ_LIMIT_PER_RUN: 2,
        KIWI_REQ_LIMIT_PER_RUN: 500,
        TRAVELPAYOUTS_REQ_LIMIT_PER_RUN: 500,
      },
      now,
    });

    expect(capped).toHaveLength(2);
    expect(capped).toEqual(full.slice(0, 2));
  });

  it("keeps budgeted candidates distributed across enabled origins and destinations", () => {
    const candidates = discoverCandidates({
      env: {
        ALLOWED_ORIGINS: ["EZE", "AEP"],
        ENABLE_EPA: false,
        DUFFEL_REQ_LIMIT_PER_RUN: 20,
        KIWI_REQ_LIMIT_PER_RUN: 20,
        TRAVELPAYOUTS_REQ_LIMIT_PER_RUN: 20,
      },
      now: new Date("2026-04-25T00:00:00.000Z"),
    });

    expect(candidates).toHaveLength(20);
    expect(uniqueValues(candidates.map((candidate) => candidate.origin)).sort()).toEqual([
      "AEP",
      "EZE",
    ]);
    expect(uniqueValues(candidates.map((candidate) => candidate.destination)).sort()).toEqual([
      "BCN",
      "LIM",
      "MAD",
      "MIA",
      "SCL",
    ]);
  });

  it("uses deterministic tail slice when overflow behavior is defer", () => {
    const now = new Date("2026-04-25T00:00:00.000Z");
    const full = discoverCandidates({
      env: {
        ...highBudgetEnv,
        ALLOWED_ORIGINS: ["EZE"],
        ENABLE_EPA: false,
      },
      now,
    });

    const deferred = discoverCandidates({
      env: {
        ALLOWED_ORIGINS: ["EZE"],
        ENABLE_EPA: false,
        DUFFEL_REQ_LIMIT_PER_RUN: 2,
        KIWI_REQ_LIMIT_PER_RUN: 2,
        TRAVELPAYOUTS_REQ_LIMIT_PER_RUN: 2,
        PROVIDER_LIMIT_OVERFLOW_BEHAVIOR: "defer",
      },
      now,
    });

    expect(deferred).toHaveLength(2);
    expect(deferred).toEqual(full.slice(-2));
  });

  it("returns identical ordering for the same injected now and env overrides", () => {
    const now = new Date("2026-06-01T12:00:00.000Z");
    const env = {
      ...highBudgetEnv,
      ALLOWED_ORIGINS: ["AEP", "EZE"],
      ENABLE_EPA: false,
      DUFFEL_REQ_LIMIT_PER_RUN: 5,
      KIWI_REQ_LIMIT_PER_RUN: 5,
      TRAVELPAYOUTS_REQ_LIMIT_PER_RUN: 5,
    };

    const a = discoverCandidates({ env, now });
    const b = discoverCandidates({ env, now });

    expect(a).toEqual(b);
  });

  it("clears prior ambient env pollution before discovery tests run", () => {
    vi.stubEnv("PORT", "invalid");
    stubHermeticAmbientEnv();

    const candidates = discoverCandidates({
      env: {
        ALLOWED_ORIGINS: ["EZE"],
        ENABLE_EPA: false,
        DUFFEL_REQ_LIMIT_PER_RUN: 1,
        KIWI_REQ_LIMIT_PER_RUN: 1,
        TRAVELPAYOUTS_REQ_LIMIT_PER_RUN: 1,
      },
      now: new Date("2026-04-25T00:00:00.000Z"),
    });

    expect(candidates).toHaveLength(1);
  });

  it("inherits ambient process budgets when an override is not supplied", () => {
    stubHermeticAmbientEnv({ DUFFEL_REQ_LIMIT_PER_RUN: "2" });

    const candidates = discoverCandidates({
      env: {
        ALLOWED_ORIGINS: ["EZE"],
        ENABLE_EPA: false,
        KIWI_REQ_LIMIT_PER_RUN: 500,
        TRAVELPAYOUTS_REQ_LIMIT_PER_RUN: 500,
      },
      now: new Date("2026-04-25T00:00:00.000Z"),
    });

    expect(candidates).toHaveLength(2);
  });

  it("prefers explicit overrides over ambient process budgets", () => {
    stubHermeticAmbientEnv({ DUFFEL_REQ_LIMIT_PER_RUN: "5" });

    const candidates = discoverCandidates({
      env: {
        ALLOWED_ORIGINS: ["EZE"],
        ENABLE_EPA: false,
        DUFFEL_REQ_LIMIT_PER_RUN: 1,
        KIWI_REQ_LIMIT_PER_RUN: 500,
        TRAVELPAYOUTS_REQ_LIMIT_PER_RUN: 500,
      },
      now: new Date("2026-04-25T00:00:00.000Z"),
    });

    expect(candidates).toHaveLength(1);
  });
});
