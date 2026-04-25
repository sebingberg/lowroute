import { type Env, readEnv } from "@lowroute/config";

import type { Money } from "../value-objects/money.js";

export type BaselineStats = {
  readonly route_key: string;
  readonly p20: Money;
  readonly median: Money;
  readonly sample_size: number;
};

export type DealBaselineService = {
  readonly thresholdFor: (baseline: BaselineStats) => Money;
  readonly shouldConsiderDeal: (baseline: BaselineStats, normalizedPayable: Money) => boolean;
};

export type DealBaselineConfig = Pick<Env, "DEAL_PERCENTILE_THRESHOLD" | "DEAL_DISCOUNT_PCT">;

export const buildDealBaselineService = (
  env: DealBaselineConfig = readEnv(process.env),
): DealBaselineService => {
  const thresholdFor = (baseline: BaselineStats): Money => {
    const percentileThreshold =
      env.DEAL_PERCENTILE_THRESHOLD <= 0.2 ? baseline.p20 : baseline.median;

    if (env.DEAL_DISCOUNT_PCT === undefined) {
      return percentileThreshold;
    }

    const discountThreshold = baseline.median.multiply(1 - env.DEAL_DISCOUNT_PCT);
    return discountThreshold.amount > percentileThreshold.amount
      ? discountThreshold
      : percentileThreshold;
  };

  return {
    thresholdFor,
    shouldConsiderDeal: (baseline, normalizedPayable) =>
      normalizedPayable.amount <= thresholdFor(baseline).amount,
  };
};
