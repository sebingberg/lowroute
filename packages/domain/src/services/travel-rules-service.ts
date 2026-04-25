import { type Env, MIN_TRIP_DAYS_BY_TIER, readEnv } from "@lowroute/config";

import type { NormalizedOffer } from "../entities/offer.js";

export type TravelRulesService = {
  readonly passesHardRules: (offer: NormalizedOffer) => boolean;
};

export type TravelRulesConfig = Pick<Env, "MAX_LAYOVER_HOURS">;

export const buildTravelRulesService = (
  env: TravelRulesConfig = readEnv(process.env),
): TravelRulesService => {
  return {
    passesHardRules: (offer) => {
      const minTripDays = MIN_TRIP_DAYS_BY_TIER[offer.destination_tier];
      return (
        offer.cabin === "economy" &&
        offer.carry_on_included &&
        offer.max_layover_hours <= env.MAX_LAYOVER_HOURS &&
        offer.trip_days >= minTripDays
      );
    },
  };
};
