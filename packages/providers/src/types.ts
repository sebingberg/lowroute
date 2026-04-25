export type ProviderName = "duffel" | "kiwi" | "travelpayouts";

export type SearchCabin = "economy";

export type NormalizedSearchRequest = {
  readonly origin: string;
  readonly destination: string;
  readonly departure_date: string;
  readonly return_date: string;
  readonly cabin: SearchCabin;
  readonly adults: 1;
  readonly max_layover_hours: number;
};

export type ProviderRiskFlags = {
  readonly self_transfer: boolean;
  readonly separate_tickets: boolean;
  readonly airport_change: boolean;
  readonly overnight_layover: boolean;
  readonly checked_bag_included: boolean;
  readonly carry_on_included: boolean;
  readonly connection_minutes_min: number;
};

export type NormalizedProviderOffer = {
  readonly provider: ProviderName;
  readonly id: string;
  readonly origin: string;
  readonly destination: string;
  readonly departure_date: string;
  readonly return_date: string;
  readonly merchant_country: string;
  readonly currency: string;
  readonly quoted_amount: number;
  readonly risk: ProviderRiskFlags;
  readonly raw_ref: string;
};

export type ProviderProbeResult = {
  readonly provider: ProviderName;
  readonly searched_at_utc: string;
  readonly request: NormalizedSearchRequest;
  readonly offers: NormalizedProviderOffer[];
};

export interface ProviderProbe {
  run(request: NormalizedSearchRequest): Promise<ProviderProbeResult>;
}
