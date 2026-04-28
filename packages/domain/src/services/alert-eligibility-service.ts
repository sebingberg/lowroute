import { type Env, readEnv } from "@lowroute/config";

import type { NormalizedOffer } from "../entities/offer.js";
import {
  buildAlertFingerprint,
  buildOfferFingerprint,
  DEFAULT_ALERT_TEMPLATE_VERSION,
} from "./alert-fingerprints.js";
import type { BaselineStats } from "./deal-baseline-service.js";
import { buildDealBaselineService } from "./deal-baseline-service.js";

export type AlertDeliverySuppression = {
  readonly wasSentRecently: (alertFingerprint: string, cooldownHours: number) => Promise<boolean>;
};

export type AlertEligibilityService = {
  readonly shouldAlert: (offer: NormalizedOffer, baseline: BaselineStats | null) => boolean;
  readonly shouldAlertForDelivery: (
    offer: NormalizedOffer,
    baseline: BaselineStats | null,
    options: AlertDeliverySuppression & {
      readonly telegramChatId: string;
      readonly alertCooldownHours: number;
    },
  ) => Promise<boolean>;
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

    shouldAlertForDelivery: async (offer, baseline, options) => {
      if (!baseline || !baselineService.shouldConsiderDeal(baseline, offer.normalized_payable)) {
        return false;
      }

      const offerFingerprint = buildOfferFingerprint(offer);
      const alertFingerprint = buildAlertFingerprint(
        offerFingerprint,
        options.telegramChatId,
        DEFAULT_ALERT_TEMPLATE_VERSION,
      );

      if (await options.wasSentRecently(alertFingerprint, options.alertCooldownHours)) {
        return false;
      }

      return true;
    },
  };
};
