import type {
  NormalizedProviderOffer,
  NormalizedSearchRequest,
  ProviderProbe,
  ProviderProbeResult,
} from "../types.js";

const fakeTravelpayoutsOffer = (request: NormalizedSearchRequest): NormalizedProviderOffer => {
  return {
    provider: "travelpayouts",
    id: `tp-${request.origin}-${request.destination}-${request.departure_date}`,
    origin: request.origin,
    destination: request.destination,
    departure_date: request.departure_date,
    return_date: request.return_date,
    merchant_country: "US",
    currency: "USD",
    quoted_amount: 745,
    risk: {
      self_transfer: false,
      separate_tickets: false,
      airport_change: false,
      overnight_layover: true,
      checked_bag_included: false,
      carry_on_included: true,
      connection_minutes_min: 95,
    },
    raw_ref: "fixture:travelpayouts:sample",
  };
};

export const travelpayoutsProbe: ProviderProbe = {
  async run(request: NormalizedSearchRequest): Promise<ProviderProbeResult> {
    return {
      provider: "travelpayouts",
      searched_at_utc: new Date().toISOString(),
      request,
      offers: [fakeTravelpayoutsOffer(request)],
    };
  },
};
