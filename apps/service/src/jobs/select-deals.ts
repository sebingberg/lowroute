import {
  type BaselineStats,
  buildAlertEligibilityService,
  type NormalizedOffer,
} from "@lowroute/domain";

export const selectDeals = (
  offers: NormalizedOffer[],
  baselinesByRoute: ReadonlyMap<string, BaselineStats>,
): NormalizedOffer[] => {
  const eligibility = buildAlertEligibilityService();
  return offers.filter((offer) =>
    eligibility.shouldAlert(
      offer,
      baselinesByRoute.get(`${offer.origin}-${offer.destination}`) ?? null,
    ),
  );
};
