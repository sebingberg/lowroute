import { ITINERARY_PENALTIES } from "@lowroute/config";

import type { NormalizedOffer } from "../entities/offer.js";

export type ScoringService = {
  readonly score: (offer: NormalizedOffer) => number;
  readonly rank: (offers: NormalizedOffer[]) => NormalizedOffer[];
};

export const buildScoringService = (): ScoringService => {
  const score = (offer: NormalizedOffer): number => {
    let currentScore = -offer.normalized_payable.amount;

    if (offer.airport_change) {
      currentScore -= ITINERARY_PENALTIES.airport_change;
    }
    if (offer.overnight_layover) {
      currentScore -= ITINERARY_PENALTIES.overnight_layover;
    }
    if (offer.self_transfer) {
      currentScore -= ITINERARY_PENALTIES.self_transfer;
    }
    if (offer.separate_tickets) {
      currentScore -= ITINERARY_PENALTIES.separate_tickets;
    }
    if (offer.self_transfer && offer.connection_minutes_min < 90) {
      currentScore -= ITINERARY_PENALTIES.short_self_connection;
    }

    return Number(currentScore.toFixed(2));
  };

  return {
    score,
    rank: (offers) => {
      return [...offers]
        .map((offer) => ({ ...offer, score: score(offer) }))
        .sort((a, b) => b.score - a.score);
    },
  };
};
