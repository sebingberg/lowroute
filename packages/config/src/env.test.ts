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
});
