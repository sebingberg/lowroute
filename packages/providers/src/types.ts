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

// ! Raw provider quote; Money conversion happens at domain normalization,
// ! so adapters keep the wire currency plus a plain decimal amount.
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
  run(
    request: NormalizedSearchRequest,
    options?: ProviderProbeOptions,
  ): Promise<ProviderProbeResult>;
}

/** Machine-readable failure reason shared by every provider adapter. */
export type ProviderErrorCode =
  | "missing_credentials"
  | "invalid_request"
  | "auth"
  | "rate_limited"
  | "timeout"
  | "bad_response"
  | "unavailable";

const RETRYABLE_ERROR_CODES: ReadonlySet<ProviderErrorCode> = new Set([
  "rate_limited",
  "timeout",
  "unavailable",
]);

/** Single error shape every provider adapter throws on transport or mapping failures. */
export class ProviderRequestError extends Error {
  override readonly name = "ProviderRequestError";
  readonly provider: ProviderName;
  readonly code: ProviderErrorCode;
  readonly retryable: boolean;
  readonly status?: number;

  constructor(input: {
    readonly provider: ProviderName;
    readonly code: ProviderErrorCode;
    readonly message: string;
    readonly status?: number;
    readonly retryable?: boolean;
    readonly cause?: unknown;
  }) {
    super(input.message, { cause: input.cause });
    this.provider = input.provider;
    this.code = input.code;
    this.status = input.status;
    this.retryable = input.retryable ?? RETRYABLE_ERROR_CODES.has(input.code);
  }
}

/** Injectable knobs shared by every live probe (auth, timeout, mocked HTTP in tests). */
export type ProviderProbeOptions = {
  readonly apiKey?: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
};

/** Single casing rule for wire currency codes; undefined unless the value is a 3-letter code. */
export const normalizeCurrencyCode = (value: unknown): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  const code = value.toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : undefined;
};

/** Probe-side enforcement of the search layover cap (AGENTS.md Domain Rules). */
export const exceedsLayoverCap = (
  request: NormalizedSearchRequest,
  layoverMinutes: readonly number[],
): boolean => layoverMinutes.some((minutes) => minutes > request.max_layover_hours * 60);
