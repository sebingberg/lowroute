import { requestJson, resolveApiKey } from "../http.js";
import {
  exceedsLayoverCap,
  type NormalizedProviderOffer,
  type NormalizedSearchRequest,
  normalizeCurrencyCode,
  type ProviderProbe,
  type ProviderProbeOptions,
  type ProviderProbeResult,
  ProviderRequestError,
} from "../types.js";

const DUFFEL_API_URL = "https://api.duffel.com/air/offer_requests";
const DUFFEL_API_KEY_ENV = "DUFFEL_API_KEY";
const MAX_DUFFEL_OFFERS = 10;
// ! Duffel owner (airline) carries no merchant country, so live offers mark it unknown.
const UNKNOWN_MERCHANT_COUNTRY = "XX";

type DuffelSegment = {
  readonly from: string;
  readonly to: string;
  readonly departMs: number;
  readonly arriveMs: number;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readString = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

const readTimeMs = (value: unknown): number => {
  const ms = typeof value === "string" ? Date.parse(value) : Number.NaN;
  return Number.isFinite(ms) ? ms : Number.NaN;
};

// ! Segments stay grouped per slice so the turnaround gap between outbound
// ! and return never counts as a layover.
const collectSlices = (offer: Record<string, unknown>): DuffelSegment[][] => {
  const slices = offer.slices;
  if (!Array.isArray(slices)) {
    return [];
  }
  return slices.flatMap((slice): DuffelSegment[][] => {
    if (!isRecord(slice) || !Array.isArray(slice.segments)) {
      return [];
    }
    const segments = slice.segments.flatMap((segment): DuffelSegment[] => {
      if (!isRecord(segment) || !isRecord(segment.origin) || !isRecord(segment.destination)) {
        return [];
      }
      const from = readString(segment.origin.iata_code);
      const to = readString(segment.destination.iata_code);
      if (!from || !to) {
        return [];
      }
      return [
        {
          from,
          to,
          departMs: readTimeMs(segment.departing_at),
          arriveMs: readTimeMs(segment.arriving_at),
        },
      ];
    });
    return segments.length > 0 ? [segments] : [];
  });
};

const connectionMinutes = (segments: readonly DuffelSegment[]): number[] => {
  const minutes: number[] = [];
  for (let index = 1; index < segments.length; index += 1) {
    const previous = segments[index - 1];
    const current = segments[index];
    if (
      previous &&
      current &&
      Number.isFinite(previous.arriveMs) &&
      Number.isFinite(current.departMs)
    ) {
      minutes.push(Math.max(0, Math.round((current.departMs - previous.arriveMs) / 60_000)));
    }
  }
  return minutes;
};

const utcDate = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

const mapOffer = (
  offer: unknown,
  request: NormalizedSearchRequest,
  offerRequestId: string,
): NormalizedProviderOffer | null => {
  if (!isRecord(offer)) {
    return null;
  }
  const id = readString(offer.id);
  const amount = typeof offer.total_amount === "string" ? Number(offer.total_amount) : Number.NaN;
  const currency = normalizeCurrencyCode(offer.total_currency);
  if (!id || !Number.isFinite(amount) || amount <= 0 || !currency) {
    return null;
  }
  const slices = collectSlices(offer);
  // ! With no usable slices there is no itinerary to price; the cap check
  // ! would pass vacuous layovers, so reject incomplete offers up front.
  if (
    slices.length === 0 ||
    slices.some((segments) =>
      segments.some(
        (segment) => !Number.isFinite(segment.departMs) || !Number.isFinite(segment.arriveMs),
      ),
    )
  ) {
    return null;
  }
  const layovers = slices.flatMap((segments) => connectionMinutes(segments));
  // ! No downstream stage enforces the cap, so over-cap itineraries are dropped here.
  if (exceedsLayoverCap(request, layovers)) {
    return null;
  }
  const airportChange = slices.some((segments) =>
    segments.some((segment, index) => index > 0 && segment.from !== segments[index - 1]?.to),
  );
  const overnightLayover = slices.some((segments) =>
    segments.some((segment, index) => {
      if (index === 0) {
        return false;
      }
      const previous = segments[index - 1];
      return (
        previous !== undefined &&
        Number.isFinite(previous.arriveMs) &&
        Number.isFinite(segment.departMs) &&
        utcDate(previous.arriveMs) !== utcDate(segment.departMs)
      );
    }),
  );
  return {
    provider: "duffel",
    id,
    origin: request.origin,
    destination: request.destination,
    departure_date: request.departure_date,
    return_date: request.return_date,
    merchant_country: UNKNOWN_MERCHANT_COUNTRY,
    currency,
    quoted_amount: amount,
    risk: {
      self_transfer: false,
      separate_tickets: false,
      airport_change: airportChange,
      overnight_layover: overnightLayover,
      // ! Search responses carry no baggage inclusion, so assume the stricter case.
      checked_bag_included: false,
      carry_on_included: true,
      connection_minutes_min: layovers.length > 0 ? Math.min(...layovers) : 0,
    },
    raw_ref: `duffel:${offerRequestId}:${id}`,
  };
};

const parseOfferRequest = (payload: unknown): { offerRequestId: string; offers: unknown[] } => {
  if (!isRecord(payload) || !isRecord(payload.data) || !Array.isArray(payload.data.offers)) {
    throw new ProviderRequestError({
      provider: "duffel",
      code: "bad_response",
      message: "duffel offer request response misses data.offers",
    });
  }
  return {
    offerRequestId: readString(payload.data.id) ?? "unknown",
    offers: payload.data.offers,
  };
};

export const duffelProbe: ProviderProbe = {
  async run(
    request: NormalizedSearchRequest,
    options: ProviderProbeOptions = {},
  ): Promise<ProviderProbeResult> {
    const apiKey = resolveApiKey("duffel", DUFFEL_API_KEY_ENV, options.apiKey);
    const payload = await requestJson<unknown>(DUFFEL_API_URL, {
      provider: "duffel",
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "duffel-version": "v2",
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        data: {
          slices: [
            {
              origin: request.origin,
              destination: request.destination,
              departure_date: request.departure_date,
            },
            {
              origin: request.destination,
              destination: request.origin,
              departure_date: request.return_date,
            },
          ],
          passengers: [{ type: "adult" }],
          cabin_class: request.cabin,
        },
      }),
      timeoutMs: options.timeoutMs,
      fetchImpl: options.fetchImpl,
    });

    const { offerRequestId, offers } = parseOfferRequest(payload);
    const mapped = offers
      .map((offer) => mapOffer(offer, request, offerRequestId))
      .filter((offer): offer is NormalizedProviderOffer => offer !== null)
      .sort((a, b) => a.quoted_amount - b.quoted_amount)
      .slice(0, MAX_DUFFEL_OFFERS);

    return {
      provider: "duffel",
      searched_at_utc: new Date().toISOString(),
      request,
      offers: mapped,
    };
  },
};
