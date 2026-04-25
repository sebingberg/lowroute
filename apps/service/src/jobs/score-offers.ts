import { buildScoringService, type NormalizedOffer } from "@lowroute/domain";

export const scoreOffers = (offers: NormalizedOffer[]): NormalizedOffer[] => {
  const scoringService = buildScoringService();
  return scoringService.rank(offers);
};
