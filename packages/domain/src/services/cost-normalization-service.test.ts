import { describe, expect, it } from "vitest";

import { Money } from "../value-objects/money.js";
import { buildCostNormalizationService } from "./cost-normalization-service.js";

describe("cost normalization", () => {
  it("keeps foreign-card outside-AR offers unchanged in USD", () => {
    const service = buildCostNormalizationService();

    const normalized = service.normalizePayableUsd({
      quoted_price: Money.fromDecimal(500, "USD"),
      merchant_country: "US",
      payment_path: "foreign_card",
      local_units_per_usd: 1,
      ar_tax_multiplier: 1.6,
    });

    expect(normalized.amount).toBe(500);
    expect(normalized.currency).toBe("USD");
  });

  it("converts non-USD quotes with local units per USD", () => {
    const service = buildCostNormalizationService();

    const normalized = service.normalizePayableUsd({
      quoted_price: Money.fromDecimal(100_000, "ARS"),
      merchant_country: "ES",
      payment_path: "merchant_outside_ar",
      local_units_per_usd: 1000,
      ar_tax_multiplier: 1.6,
    });

    expect(normalized.amount).toBe(100);
  });

  it("applies AR tax multiplier only for AR-card AR-merchant exception path", () => {
    const service = buildCostNormalizationService();

    const normalized = service.normalizePayableUsd({
      quoted_price: Money.fromDecimal(100, "USD"),
      merchant_country: "AR",
      payment_path: "ar_card",
      local_units_per_usd: 1,
      ar_tax_multiplier: 1.6,
      ar_exception_class: "aerolineas_ars_promo",
    });

    expect(normalized.amount).toBe(160);
  });
});
