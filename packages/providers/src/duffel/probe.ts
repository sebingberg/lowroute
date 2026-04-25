import type {
  NormalizedProviderOffer,
  NormalizedSearchRequest,
  ProviderProbe,
  ProviderProbeResult,
} from "../types.js";

const fakeDuffelOffer = (request: NormalizedSearchRequest): NormalizedProviderOffer => {
  return {
    provider: "duffel",
    id: `duffel-${request.origin}-${request.destination}-${request.departure_date}`,
    origin: request.origin,
    destination: request.destination,
    departure_date: request.departure_date,
    return_date: request.return_date,
    merchant_country: "US",
    currency: "USD",
    quoted_amount: 699,
    risk: {
      self_transfer: false,
      separate_tickets: false,
      airport_change: false,
      overnight_layover: false,
      checked_bag_included: false,
      carry_on_included: true,
      connection_minutes_min: 120,
    },
    raw_ref: "fixture:duffel:sample",
  };
};

export const duffelProbe: ProviderProbe = {
  async run(request: NormalizedSearchRequest): Promise<ProviderProbeResult> {
    return {
      provider: "duffel",
      searched_at_utc: new Date().toISOString(),
      request,
      offers: [fakeDuffelOffer(request)],
    };
  },
};
