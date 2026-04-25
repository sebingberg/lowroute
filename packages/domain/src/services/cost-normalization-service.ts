import type { ArMerchantExceptionClass, PaymentPath } from "../entities/offer.js";
import { Money } from "../value-objects/money.js";

export type CostNormalizationInput = {
  readonly quoted_price: Money;
  readonly merchant_country: string;
  readonly payment_path: PaymentPath;
  readonly local_units_per_usd: number;
  readonly ar_tax_multiplier: number;
  readonly ar_exception_class?: ArMerchantExceptionClass;
};

export type CostNormalizationService = {
  readonly normalizePayableUsd: (input: CostNormalizationInput) => Money;
};

export const buildCostNormalizationService = (): CostNormalizationService => {
  return {
    normalizePayableUsd: (input) => {
      const baseUsd =
        input.quoted_price.currency === "USD"
          ? input.quoted_price.amount
          : input.quoted_price.amount / input.local_units_per_usd;
      const applyArTax =
        input.payment_path === "ar_card" &&
        input.merchant_country.toUpperCase() === "AR" &&
        input.ar_exception_class !== undefined;
      return Money.fromDecimal(baseUsd * (applyArTax ? input.ar_tax_multiplier : 1), "USD");
    },
  };
};
