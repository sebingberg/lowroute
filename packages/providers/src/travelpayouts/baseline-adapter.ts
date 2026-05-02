import { type BaselineStats, Money } from "@lowroute/domain";

export type TravelpayoutsRouteBaseline = {
  readonly origin: string;
  readonly destination: string;
  readonly p20: number;
  readonly median: number;
  readonly sample_size: number;
};

export class TravelpayoutsParseError extends Error {
  override readonly name = "TravelpayoutsParseError";
}

/**
 * History payload accepts either the provider envelope (`success` + `data`
 * records with `price`) or a normalized helper shape with `prices`.
 */
export type TravelpayoutsHistoryPayload = {
  readonly origin: string;
  readonly destination: string;
  readonly prices: readonly number[];
};

/**
 * Trend payload accepts either the provider envelope (`success` + `data[]`
 * records with `value`) or a normalized helper shape with `points[].price`.
 */
export type TravelpayoutsTrendPayload = {
  readonly origin: string;
  readonly destination: string;
  readonly points: readonly { readonly price: number }[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readIata = (value: unknown, field: string): string => {
  if (typeof value !== "string" || !/^[A-Za-z]{3}$/.test(value)) {
    throw new TravelpayoutsParseError(`${field} must be a 3-letter IATA code`);
  }
  return value.toUpperCase();
};

const maybeReadIata = (value: unknown, field: string): string | undefined => {
  if (value === undefined) {
    return undefined;
  }
  return readIata(value, field);
};

const readFinitePrice = (value: unknown, field: string): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TravelpayoutsParseError(`${field} must be a finite number`);
  }
  if (value <= 0) {
    throw new TravelpayoutsParseError(`${field} must be positive`);
  }
  return value;
};

/**
 * 20th percentile uses linear interpolation at position `(n - 1) * 0.2`
 * over sorted samples. Median stays explicit so even-sized samples average
 * the middle pair rather than depending on the percentile helper.
 */
const interpolateSortedPercentile = (sorted: readonly number[], percentile: number): number => {
  const position = (sorted.length - 1) * percentile;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = sorted.at(lowerIndex);
  const upper = sorted.at(upperIndex);
  if (lower === undefined || upper === undefined) {
    throw new TravelpayoutsParseError("internal: percentile index out of range");
  }
  if (lowerIndex === upperIndex) {
    return lower;
  }
  return lower + (upper - lower) * (position - lowerIndex);
};

const summarizePriceSamples = (prices: readonly number[]): { p20: number; median: number } => {
  if (prices.length === 0) {
    throw new TravelpayoutsParseError("price sample is empty");
  }
  const sorted = [...prices].sort((a, b) => a - b);
  const n = sorted.length;
  const p20 = interpolateSortedPercentile(sorted, 0.2);
  const mid = Math.floor((n - 1) / 2);
  let median: number;
  if (n % 2 === 1) {
    const v = sorted.at(mid);
    if (v === undefined) {
      throw new TravelpayoutsParseError("internal: median index out of range");
    }
    median = v;
  } else {
    const a = sorted.at(mid);
    const b = sorted.at(mid + 1);
    if (a === undefined || b === undefined) {
      throw new TravelpayoutsParseError("internal: median pair out of range");
    }
    median = (a + b) / 2;
  }
  return { p20, median };
};

const collectEnvelopeRecords = (
  value: unknown,
  priceField: "price" | "value",
  out: Record<string, unknown>[],
): void => {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectEnvelopeRecords(item, priceField, out);
    }
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  if (priceField in value) {
    out.push(value);
    return;
  }

  for (const nested of Object.values(value)) {
    collectEnvelopeRecords(nested, priceField, out);
  }
};

const resolveEnvelopeRecords = (
  payload: Record<string, unknown>,
  label: "history" | "trend",
  priceField: "price" | "value",
): Record<string, unknown>[] => {
  if (payload.success !== true) {
    throw new TravelpayoutsParseError(`${label} payload success must be true`);
  }
  const rawData = payload.data;
  const records: Record<string, unknown>[] = [];
  collectEnvelopeRecords(rawData, priceField, records);
  if (records.length === 0) {
    throw new TravelpayoutsParseError(`data must contain at least one ${priceField} record`);
  }
  return records;
};

const rejectFailedSuccessFlag = (
  payload: Record<string, unknown>,
  label: "history" | "trend",
): void => {
  if ("success" in payload && payload.success !== true) {
    throw new TravelpayoutsParseError(`${label} payload success must be true`);
  }
};

const resolveRoute = (
  payload: Record<string, unknown>,
  records: readonly Record<string, unknown>[],
): { origin: string; destination: string } => {
  const rootOrigin = maybeReadIata(payload.origin, "origin");
  const rootDestination = maybeReadIata(payload.destination, "destination");
  let resolvedOrigin: string | undefined;
  let resolvedDestination: string | undefined;

  records.forEach((record, index) => {
    const recordOrigin = maybeReadIata(record.origin, `data[${index}].origin`);
    const recordDestination = maybeReadIata(record.destination, `data[${index}].destination`);

    if (rootOrigin && recordOrigin && recordOrigin !== rootOrigin) {
      throw new TravelpayoutsParseError(`data[${index}].origin must match payload origin`);
    }
    if (rootDestination && recordDestination && recordDestination !== rootDestination) {
      throw new TravelpayoutsParseError(
        `data[${index}].destination must match payload destination`,
      );
    }

    const origin = recordOrigin ?? rootOrigin;
    const destination = recordDestination ?? rootDestination;

    if (!origin) {
      throw new TravelpayoutsParseError(
        "origin must be present on the payload root or each data row",
      );
    }
    if (!destination) {
      throw new TravelpayoutsParseError(
        "destination must be present on the payload root or each data row",
      );
    }
    if (resolvedOrigin && resolvedOrigin !== origin) {
      throw new TravelpayoutsParseError("data rows must resolve to a single origin");
    }
    if (resolvedDestination && resolvedDestination !== destination) {
      throw new TravelpayoutsParseError("data rows must resolve to a single destination");
    }

    resolvedOrigin = origin;
    resolvedDestination = destination;
  });

  if (!resolvedOrigin || !resolvedDestination) {
    throw new TravelpayoutsParseError("data must contain at least one route record");
  }

  return {
    origin: resolvedOrigin,
    destination: resolvedDestination,
  };
};

export const parseTravelpayoutsHistoryPayload = (value: unknown): TravelpayoutsRouteBaseline => {
  if (!isRecord(value)) {
    throw new TravelpayoutsParseError("history payload must be a JSON object");
  }

  rejectFailedSuccessFlag(value, "history");

  if (Array.isArray(value.prices)) {
    const origin = readIata(value.origin, "origin");
    const destination = readIata(value.destination, "destination");
    const prices = value.prices.map((price, index) => readFinitePrice(price, `prices[${index}]`));
    const { p20, median } = summarizePriceSamples(prices);
    return {
      origin,
      destination,
      p20,
      median,
      sample_size: prices.length,
    };
  }

  const records = resolveEnvelopeRecords(value, "history", "price");
  const { origin, destination } = resolveRoute(value, records);
  const prices = records.map((record, index) =>
    readFinitePrice(record.price, `data[${index}].price`),
  );
  const { p20, median } = summarizePriceSamples(prices);
  return {
    origin,
    destination,
    p20,
    median,
    sample_size: prices.length,
  };
};

export const parseTravelpayoutsTrendPayload = (value: unknown): TravelpayoutsRouteBaseline => {
  if (!isRecord(value)) {
    throw new TravelpayoutsParseError("trend payload must be a JSON object");
  }

  rejectFailedSuccessFlag(value, "trend");

  if (Array.isArray(value.points)) {
    const origin = readIata(value.origin, "origin");
    const destination = readIata(value.destination, "destination");
    const prices = value.points.map((pt, i) => {
      if (!isRecord(pt)) {
        throw new TravelpayoutsParseError(`points[${i}] must be an object`);
      }
      return readFinitePrice(pt.price, `points[${i}].price`);
    });
    const { p20, median } = summarizePriceSamples(prices);
    return {
      origin,
      destination,
      p20,
      median,
      sample_size: prices.length,
    };
  }

  const records = resolveEnvelopeRecords(value, "trend", "value");
  const { origin, destination } = resolveRoute(value, records);
  const prices = records.map((record, index) =>
    readFinitePrice(record.value, `data[${index}].value`),
  );
  const { p20, median } = summarizePriceSamples(prices);
  return {
    origin,
    destination,
    p20,
    median,
    sample_size: prices.length,
  };
};

export const toBaselineStats = (input: TravelpayoutsRouteBaseline): BaselineStats => {
  return {
    route_key: `${input.origin}-${input.destination}`,
    p20: Money.fromDecimal(input.p20, "USD"),
    median: Money.fromDecimal(input.median, "USD"),
    sample_size: input.sample_size,
  };
};
