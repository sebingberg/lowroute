import { type Env, readEnv } from "@lowroute/config";

import type { NormalizedOffer } from "../entities/offer.js";
import type { BaselineStats } from "./deal-baseline-service.js";
import { buildDealBaselineService } from "./deal-baseline-service.js";

export type AlertEligibilityService = {
  readonly shouldAlert: (offer: NormalizedOffer, baseline: BaselineStats | null) => boolean;
};

export type AlertEligibilityConfig = Pick<Env, "DEAL_PERCENTILE_THRESHOLD" | "DEAL_DISCOUNT_PCT">;

export const buildAlertEligibilityService = (
  env: AlertEligibilityConfig = readEnv(process.env),
): AlertEligibilityService => {
  const baselineService = buildDealBaselineService(env);

  return {
    shouldAlert: (offer, baseline) => {
      if (!baseline) {
        return false;
      }

      return baselineService.shouldConsiderDeal(baseline, offer.normalized_payable);
    },
  };
};
