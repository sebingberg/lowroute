import { requestJson, resolveApiKey } from "../http.js";
import {
  type NormalizedProviderOffer,
  type NormalizedSearchRequest,
  normalizeCurrencyCode,
  type ProviderProbe,
  type ProviderProbeOptions,
  type ProviderProbeResult,
  ProviderRequestError,
} from "../types.js";

const TRAVELPAYOUTS_CHEAP_URL = "https://api.travelpayouts.com/v1/prices/cheap";
const TRAVELPAYOUTS_TOKEN_ENV = "TRAVELPAYOUTS_TOKEN";
const MAX_TRAVELPAYOUTS_OFFERS = 10;
// ! Cheap prices redirect to third-party sellers, so the merchant stays unknown.
const UNKNOWN_MERCHANT_COUNTRY = "XX";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readPrice = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : Number.NaN;

const monthOf = (date: string): string => date.slice(0, 7);

const mapEntry = (
  dateKey: string,
  entry: unknown,
  request: NormalizedSearchRequest,
  currency: string,
): NormalizedProviderOffer | null => {
  if (!isRecord(entry)) {
    return null;
  }
  const price = readPrice(entry.price);
  if (!Number.isFinite(price)) {
    return null;
  }
  // ! Cheap entries are keyed by position, so prefer the priced departure date for stable ids.
  // ! The monthly response spans many dates; attributing the price to the
  // ! requested date would mislabel it, so carry the validated provider date.
  const pricedDate =
    typeof entry.departure_at === "string" ? entry.departure_at.slice(0, 10) : dateKey;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(pricedDate)) {
    return null;
  }
  return {
    provider: "travelpayouts",
    id: `tp-cheap-${request.origin}-${request.destination}-${pricedDate}`,
    origin: request.origin,
    destination: request.destination,
    departure_date: pricedDate,
    return_date: request.return_date,
    merchant_country: UNKNOWN_MERCHANT_COUNTRY,
    currency,
    quoted_amount: price,
    risk: {
      self_transfer: false,
      separate_tickets: false,
      airport_change: false,
      overnight_layover: false,
      // ! Cheap responses carry no baggage inclusion, so assume the stricter case.
      checked_bag_included: false,
      carry_on_included: true,
      connection_minutes_min: 0,
    },
    raw_ref: `travelpayouts:cheap:${request.origin}-${request.destination}:${pricedDate}`,
  };
};

export const travelpayoutsProbe: ProviderProbe = {
  async run(
    request: NormalizedSearchRequest,
    options: ProviderProbeOptions = {},
  ): Promise<ProviderProbeResult> {
    const token = resolveApiKey("travelpayouts", TRAVELPAYOUTS_TOKEN_ENV, options.apiKey);
    const params = new URLSearchParams({
      origin: request.origin,
      destination: request.destination,
      depart_date: monthOf(request.departure_date),
      return_date: monthOf(request.return_date),
      currency: "USD",
      token,
    });
    const payload = await requestJson<unknown>(`${TRAVELPAYOUTS_CHEAP_URL}?${params.toString()}`, {
      provider: "travelpayouts",
      method: "GET",
      headers: { accept: "application/json" },
      timeoutMs: options.timeoutMs,
      fetchImpl: options.fetchImpl,
    });

    if (!isRecord(payload) || payload.success !== true || !isRecord(payload.data)) {
      throw new ProviderRequestError({
        provider: "travelpayouts",
        code: "bad_response",
        message: "travelpayouts cheap response misses successful data",
      });
    }
    const currency = normalizeCurrencyCode(payload.currency) ?? "USD";
    const offers = Object.entries(payload.data)
      .filter(([destination]) => destination.toUpperCase() === request.destination.toUpperCase())
      .flatMap(([, dated]) =>
        isRecord(dated)
          ? Object.entries(dated).map(([dateKey, entry]) =>
              mapEntry(dateKey, entry, request, currency),
            )
          : [],
      )
      .filter((offer): offer is NormalizedProviderOffer => offer !== null)
      .sort((a, b) => a.quoted_amount - b.quoted_amount)
      .slice(0, MAX_TRAVELPAYOUTS_OFFERS);

    return {
      provider: "travelpayouts",
      searched_at_utc: new Date().toISOString(),
      request,
      offers,
    };
  },
};
