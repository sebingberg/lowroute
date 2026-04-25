import type {
  NormalizedProviderOffer,
  NormalizedSearchRequest,
  ProviderProbe,
  ProviderProbeResult,
} from "../types.js";

const fakeKiwiOffer = (request: NormalizedSearchRequest): NormalizedProviderOffer => {
  return {
    provider: "kiwi",
    id: `kiwi-${request.origin}-${request.destination}-${request.departure_date}`,
    origin: request.origin,
    destination: request.destination,
    departure_date: request.departure_date,
    return_date: request.return_date,
    merchant_country: "CZ",
    currency: "USD",
    quoted_amount: 621,
    risk: {
      self_transfer: true,
      separate_tickets: true,
      airport_change: false,
      overnight_layover: false,
      checked_bag_included: false,
      carry_on_included: true,
      connection_minutes_min: 75,
    },
    raw_ref: "fixture:kiwi:sample",
  };
};

export const kiwiProbe: ProviderProbe = {
  async run(request: NormalizedSearchRequest): Promise<ProviderProbeResult> {
    return {
      provider: "kiwi",
      searched_at_utc: new Date().toISOString(),
      request,
      offers: [fakeKiwiOffer(request)],
    };
  },
};
