import type { BaselineStats } from "@lowroute/domain";

import { requestJson, resolveApiKey } from "../http.js";
import {
  normalizeCurrencyCode,
  type ProviderProbeOptions,
  ProviderRequestError,
} from "../types.js";
import {
  parseTravelpayoutsHistoryPayload,
  TravelpayoutsParseError,
  toBaselineStats,
} from "./baseline-adapter.js";

const TRAVELPAYOUTS_CALENDAR_URL = "https://api.travelpayouts.com/v1/prices/calendar";
const TRAVELPAYOUTS_TOKEN_ENV = "TRAVELPAYOUTS_TOKEN";

export type BaselineRefreshInput = {
  readonly origin: string;
  readonly destination: string;
  /** Calendar month as yyyy-mm. */
  readonly month: string;
};

export type BaselineRefreshDeps = ProviderProbeOptions & {
  /** Persistence sink (service layer passes `baselinesRepository.upsert`). */
  readonly upsert: (baseline: BaselineStats) => Promise<void>;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Fetch live calendar prices, parse them with the shared baseline adapter, and persist the row. */
export const refreshTravelpayoutsBaseline = async (
  input: BaselineRefreshInput,
  deps: BaselineRefreshDeps,
): Promise<BaselineStats> => {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.month)) {
    throw new ProviderRequestError({
      provider: "travelpayouts",
      code: "invalid_request",
      message: `travelpayouts baseline refresh needs yyyy-mm month, got ${input.month}`,
    });
  }
  const token = resolveApiKey("travelpayouts", TRAVELPAYOUTS_TOKEN_ENV, deps.apiKey);
  const params = new URLSearchParams({
    origin: input.origin,
    destination: input.destination,
    depart_date: input.month,
    return_date: input.month,
    calendar_type: "departure_date",
    currency: "USD",
    token,
  });
  const payload = await requestJson<unknown>(`${TRAVELPAYOUTS_CALENDAR_URL}?${params.toString()}`, {
    provider: "travelpayouts",
    method: "GET",
    headers: { accept: "application/json" },
    timeoutMs: deps.timeoutMs,
    fetchImpl: deps.fetchImpl,
  });

  // ! toBaselineStats labels amounts USD and the request forces currency=USD,
  // ! so default only when the field is absent; anything else must be USD.
  const rawCurrency = isRecord(payload) ? payload.currency : undefined;
  if (rawCurrency !== undefined && normalizeCurrencyCode(rawCurrency) !== "USD") {
    throw new ProviderRequestError({
      provider: "travelpayouts",
      code: "invalid_request",
      message: `travelpayouts calendar currency must be USD, got ${String(rawCurrency)}`,
    });
  }

  let stats: BaselineStats;
  try {
    stats = toBaselineStats(parseTravelpayoutsHistoryPayload(payload));
  } catch (error) {
    if (error instanceof TravelpayoutsParseError) {
      throw new ProviderRequestError({
        provider: "travelpayouts",
        code: "bad_response",
        message: `travelpayouts calendar payload unparseable for ${input.origin}-${input.destination}: ${error.message}`,
        cause: error,
      });
    }
    throw error;
  }

  // ! A wrong-route payload must never persist under the requested baseline.
  const expectedRouteKey = `${input.origin.toUpperCase()}-${input.destination.toUpperCase()}`;
  if (stats.route_key !== expectedRouteKey) {
    throw new ProviderRequestError({
      provider: "travelpayouts",
      code: "bad_response",
      message: `travelpayouts calendar route mismatch: wanted ${expectedRouteKey}, got ${stats.route_key}`,
    });
  }

  await deps.upsert(stats);
  return stats;
};
