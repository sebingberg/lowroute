import { describe, expect, it } from "vitest";

import { Money } from "../value-objects/money.js";
import { buildDealBaselineService } from "./deal-baseline-service.js";

describe("deal baseline service", () => {
  it("considers offer a deal when at or below p20", () => {
    const service = buildDealBaselineService({
      DEAL_PERCENTILE_THRESHOLD: 0.2,
      DEAL_DISCOUNT_PCT: undefined,
    });
    const result = service.shouldConsiderDeal(
      {
        route_key: "EZE-MAD",
        p20: Money.fromDecimal(700, "USD"),
        median: Money.fromDecimal(900, "USD"),
        sample_size: 120,
      },
      Money.fromDecimal(680, "USD"),
    );

    expect(result).toBe(true);
  });

  it("rejects offer above p20", () => {
    const service = buildDealBaselineService({
      DEAL_PERCENTILE_THRESHOLD: 0.2,
      DEAL_DISCOUNT_PCT: undefined,
    });
    const result = service.shouldConsiderDeal(
      {
        route_key: "EZE-MAD",
        p20: Money.fromDecimal(700, "USD"),
        median: Money.fromDecimal(900, "USD"),
        sample_size: 120,
      },
      Money.fromDecimal(760, "USD"),
    );

    expect(result).toBe(false);
  });

  it("supports absolute discount fallback", () => {
    const service = buildDealBaselineService({
      DEAL_PERCENTILE_THRESHOLD: 0.2,
      DEAL_DISCOUNT_PCT: 0.3,
    });

    const threshold = service.thresholdFor({
      route_key: "EZE-MAD",
      p20: Money.fromDecimal(500, "USD"),
      median: Money.fromDecimal(900, "USD"),
      sample_size: 120,
    });

    expect(threshold.amount).toBe(630);
  });
});
