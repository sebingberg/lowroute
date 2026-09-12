import { requestJson, resolveApiKey } from "../http.js";
import {
  exceedsLayoverCap,
  type NormalizedProviderOffer,
  type NormalizedSearchRequest,
  type ProviderProbe,
  type ProviderProbeOptions,
  type ProviderProbeResult,
  ProviderRequestError,
} from "../types.js";

const KIWI_API_URL = "https://api.tequila.kiwi.com/v2/search";
const KIWI_API_KEY_ENV = "KIWI_API_KEY";
const MAX_KIWI_OFFERS = 10;
// ! Tequila search results are sold by Kiwi.com, so the merchant stays CZ.
const KIWI_MERCHANT_COUNTRY = "CZ";

type KiwiLeg = {
  readonly departSec: number;
  readonly arriveSec: number;
  readonly virtualInterline: boolean;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readNumber = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : Number.NaN;

// ! Tequila expects dd/mm/yyyy while the contract carries yyyy-mm-dd.
const toTequilaDate = (date: string): string => {
  const [year, month, day] = date.split("-");
  if (!year || !month || !day) {
    throw new ProviderRequestError({
      provider: "kiwi",
      code: "invalid_request",
      message: `kiwi probe needs yyyy-mm-dd dates, got ${date}`,
    });
  }
  return `${day}/${month}/${year}`;
};

// ! Tequila mixes outbound and return legs in one route array flagged by
// ! `return`; directions stay grouped so the turnaround gap never counts as a layover.
const collectDirections = (item: Record<string, unknown>): KiwiLeg[][] => {
  if (!Array.isArray(item.route)) {
    return [];
  }
  const groups = new Map<number, KiwiLeg[]>();
  for (const entry of item.route) {
    if (!isRecord(entry)) {
      continue;
    }
    const key = entry.return === 1 ? 1 : 0;
    const leg: KiwiLeg = {
      departSec: readNumber(entry.dTimeUTC),
      arriveSec: readNumber(entry.aTimeUTC),
      virtualInterline: entry.vi_connection === true || entry.bags_recheck_required === true,
    };
    groups.set(key, [...(groups.get(key) ?? []), leg]);
  }
  return [...groups.values()];
};

const layoverMinutes = (legs: readonly KiwiLeg[]): number[] => {
  const minutes: number[] = [];
  for (let index = 1; index < legs.length; index += 1) {
    const previous = legs[index - 1];
    const current = legs[index];
    if (
      previous &&
      current &&
      Number.isFinite(previous.arriveSec) &&
      Number.isFinite(current.departSec)
    ) {
      minutes.push(Math.max(0, Math.round((current.departSec - previous.arriveSec) / 60)));
    }
  }
  return minutes;
};

const utcDate = (epochSec: number): string => new Date(epochSec * 1000).toISOString().slice(0, 10);

const mapItinerary = (
  item: unknown,
  request: NormalizedSearchRequest,
): NormalizedProviderOffer | null => {
  if (!isRecord(item)) {
    return null;
  }
  const id = item.id === undefined || item.id === null ? undefined : String(item.id);
  const price = readNumber(item.price);
  if (!id || !Number.isFinite(price) || price <= 0) {
    return null;
  }
  const directions = collectDirections(item);
  const legs = directions.flat();
  const layovers = directions.flatMap((direction) => layoverMinutes(direction));
  // ! No downstream stage enforces the cap, so over-cap itineraries are dropped here.
  if (exceedsLayoverCap(request, layovers)) {
    return null;
  }
  const overnightLayover = directions.some((direction) =>
    direction.some((leg, index) => {
      if (index === 0) {
        return false;
      }
      const previous = direction[index - 1];
      return (
        previous !== undefined &&
        Number.isFinite(previous.arriveSec) &&
        Number.isFinite(leg.departSec) &&
        utcDate(previous.arriveSec) !== utcDate(leg.departSec)
      );
    }),
  );
  return {
    provider: "kiwi",
    id,
    origin: request.origin,
    destination: request.destination,
    departure_date: request.departure_date,
    return_date: request.return_date,
    merchant_country: KIWI_MERCHANT_COUNTRY,
    currency: "USD",
    quoted_amount: price,
    risk: {
      self_transfer: legs.some((leg) => leg.virtualInterline),
      separate_tickets: readNumber(item.pnr_count) > 1,
      airport_change: item.has_airport_change === true,
      overnight_layover: overnightLayover,
      // ! Search responses carry no baggage inclusion, so assume the stricter case.
      checked_bag_included: false,
      carry_on_included: true,
      connection_minutes_min: layovers.length > 0 ? Math.min(...layovers) : 0,
    },
    raw_ref: `kiwi:${id}`,
  };
};

export const kiwiProbe: ProviderProbe = {
  async run(
    request: NormalizedSearchRequest,
    options: ProviderProbeOptions = {},
  ): Promise<ProviderProbeResult> {
    const apiKey = resolveApiKey("kiwi", KIWI_API_KEY_ENV, options.apiKey);
    const params = new URLSearchParams({
      fly_from: request.origin,
      fly_to: request.destination,
      date_from: toTequilaDate(request.departure_date),
      date_to: toTequilaDate(request.departure_date),
      return_from: toTequilaDate(request.return_date),
      return_to: toTequilaDate(request.return_date),
      flight_type: "round",
      adults: "1",
      selected_cabins: "M",
      curr: "USD",
      sort: "price",
      limit: String(MAX_KIWI_OFFERS),
    });
    const payload = await requestJson<unknown>(`${KIWI_API_URL}?${params.toString()}`, {
      provider: "kiwi",
      method: "GET",
      headers: { apikey: apiKey, accept: "application/json" },
      timeoutMs: options.timeoutMs,
      fetchImpl: options.fetchImpl,
    });

    if (!isRecord(payload) || !Array.isArray(payload.data)) {
      throw new ProviderRequestError({
        provider: "kiwi",
        code: "bad_response",
        message: "kiwi search response misses data array",
      });
    }
    const offers = payload.data
      .map((item) => mapItinerary(item, request))
      .filter((offer): offer is NormalizedProviderOffer => offer !== null)
      .sort((a, b) => a.quoted_amount - b.quoted_amount)
      .slice(0, MAX_KIWI_OFFERS);

    return {
      provider: "kiwi",
      searched_at_utc: new Date().toISOString(),
      request,
      offers,
    };
  },
};
