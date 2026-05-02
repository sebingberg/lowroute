import { describe, expect, it } from "vitest";

import { readEnv } from "./env.js";

describe("readEnv", () => {
  it("parses explicit false boolean strings as false", () => {
    const env = readEnv({
      ALERT_DRY_RUN: "false",
      TELEGRAM_ALERTS_ENABLED: "false",
    });

    expect(env.ALERT_DRY_RUN).toBe(false);
    expect(env.TELEGRAM_ALERTS_ENABLED).toBe(false);
  });

  it("parses allowed origins and EPA flag", () => {
    const env = readEnv({
      ALLOWED_ORIGINS: "EZE,AEP,EPA",
      ENABLE_EPA: "true",
    });

    expect(env.ALLOWED_ORIGINS).toEqual(["EZE", "AEP", "EPA"]);
    expect(env.ENABLE_EPA).toBe(true);
  });

  it("defaults per-provider run limits and overflow behavior", () => {
    const env = readEnv({});

    expect(env.DUFFEL_REQ_LIMIT_PER_RUN).toBe(120);
    expect(env.KIWI_REQ_LIMIT_PER_RUN).toBe(120);
    expect(env.TRAVELPAYOUTS_REQ_LIMIT_PER_RUN).toBe(120);
    expect(env.PROVIDER_LIMIT_OVERFLOW_BEHAVIOR).toBe("skip");
  });

  it("parses per-provider run limit strings and overflow behavior", () => {
    const env = readEnv({
      DUFFEL_REQ_LIMIT_PER_RUN: "10",
      KIWI_REQ_LIMIT_PER_RUN: "20",
      TRAVELPAYOUTS_REQ_LIMIT_PER_RUN: "30",
      PROVIDER_LIMIT_OVERFLOW_BEHAVIOR: "defer",
    });

    expect(env.DUFFEL_REQ_LIMIT_PER_RUN).toBe(10);
    expect(env.KIWI_REQ_LIMIT_PER_RUN).toBe(20);
    expect(env.TRAVELPAYOUTS_REQ_LIMIT_PER_RUN).toBe(30);
    expect(env.PROVIDER_LIMIT_OVERFLOW_BEHAVIOR).toBe("defer");
  });

  it("rejects invalid provider run limits and overflow behavior", () => {
    expect(() => readEnv({ DUFFEL_REQ_LIMIT_PER_RUN: "not-a-number" })).toThrow();
    expect(() => readEnv({ KIWI_REQ_LIMIT_PER_RUN: "0" })).toThrow();
    expect(() => readEnv({ PROVIDER_LIMIT_OVERFLOW_BEHAVIOR: "hold" })).toThrow();
  });
});
