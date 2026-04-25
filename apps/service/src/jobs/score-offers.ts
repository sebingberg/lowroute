import { type NormalizedOffer, buildScoringService } from "@lowroute/domain";

export const scoreOffers = (offers: NormalizedOffer[]): NormalizedOffer[] => {
  const scoringService = buildScoringService();
  return scoringService.rank(offers);
};
