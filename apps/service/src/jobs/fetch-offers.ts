import { type Env, readEnv } from "@lowroute/config";
import {
  buildTravelRulesService,
  type NormalizedOffer,
  type TravelRulesService,
  toNormalizedOffer,
} from "@lowroute/domain";
import {
  duffelProbe,
  kiwiProbe,
  type NormalizedProviderOffer,
  type NormalizedSearchRequest,
  type ProviderName,
  type ProviderProbe,
  type ProviderProbeOptions,
  type ProviderProbeResult,
  ProviderRequestError,
  travelpayoutsProbe,
} from "@lowroute/providers";

export type FetchJobInput = {
  readonly search: NormalizedSearchRequest;
};

export type FetchJobOutput = {
  readonly offers: NormalizedOffer[];
  readonly errors: ProviderRequestError[];
};

export type FetchOffersDeps = {
  readonly probes?: Readonly<Record<ProviderName, ProviderProbe>>;
  readonly probeOptions?: Omit<ProviderProbeOptions, "apiKey">;
  readonly env?: Pick<Env, "DUFFEL_API_KEY" | "KIWI_API_KEY" | "TRAVELPAYOUTS_TOKEN">;
};

const defaultProbes: Readonly<Record<ProviderName, ProviderProbe>> = {
  duffel: duffelProbe,
  kiwi: kiwiProbe,
  travelpayouts: travelpayoutsProbe,
};

const PROVIDER_ORDER: readonly ProviderName[] = ["duffel", "kiwi", "travelpayouts"];

const apiKeyFor = (
  env: Pick<Env, "DUFFEL_API_KEY" | "KIWI_API_KEY" | "TRAVELPAYOUTS_TOKEN">,
  provider: ProviderName,
): string => {
  if (provider === "kiwi") {
    return env.KIWI_API_KEY;
  }
  if (provider === "travelpayouts") {
    return env.TRAVELPAYOUTS_TOKEN;
  }
  return env.DUFFEL_API_KEY;
};

// ! One provider failing must not fail the job; errors ride along for observability.
const runProbe = async (
  provider: ProviderName,
  probe: ProviderProbe,
  input: FetchJobInput,
  deps: FetchOffersDeps,
  apiKey: string,
): Promise<ProviderProbeResult | ProviderRequestError> => {
  try {
    return await probe.run(input.search, { ...deps.probeOptions, apiKey });
  } catch (error) {
    if (error instanceof ProviderRequestError) {
      return error;
    }
    return new ProviderRequestError({
      provider,
      code: "unavailable",
      message: `${provider} probe threw unexpectedly`,
      cause: error,
    });
  }
};

export const fetchOffers = async (
  input: FetchJobInput,
  deps: FetchOffersDeps = {},
): Promise<FetchJobOutput> => {
  const env = deps.env ?? readEnv(process.env);
  const probes = deps.probes ?? defaultProbes;
  // ! Single source of truth for the layover cap: the search value flows into
  // ! both the adapter ctx and the travel-rules env, built once per batch (not
  // ! per offer). The global env MAX_LAYOVER_HOURS is intentionally bypassed on
  // ! this path.
  const rules = buildTravelRulesService({
    MAX_LAYOVER_HOURS: input.search.max_layover_hours,
  });
  const results = await Promise.all(
    PROVIDER_ORDER.map((provider) =>
      runProbe(provider, probes[provider], input, deps, apiKeyFor(env, provider)),
    ),
  );

  return {
    offers: results.flatMap((result) =>
      result instanceof ProviderRequestError
        ? []
        : toDomainOffers(result.offers, input.search.max_layover_hours, rules, result.provider),
    ),
    errors: results.filter(
      (result): result is ProviderRequestError => result instanceof ProviderRequestError,
    ),
  };
};

// ! Adapter throws on malformed quotes (bad currency, non-finite amount);
// ! drop those offers so one bad quote cannot fail the job. Fail-open with a
// ! once-per-provider-batch warn so silent provider-schema drift stays
// ! observable; FetchJobOutput shape is unchanged and providers stay isolated
// ! (one call per provider result).
const toDomainOffers = (
  offers: readonly NormalizedProviderOffer[],
  maxLayoverHours: number,
  rules: TravelRulesService,
  provider: ProviderName,
): NormalizedOffer[] => {
  let malformedDropped = 0;
  const mapped = offers.flatMap((offer) => {
    try {
      const candidate = toNormalizedOffer(offer, { maxLayoverHours }, rules);
      return candidate === null ? [] : [candidate];
    } catch {
      malformedDropped += 1;
      return [];
    }
  });
  if (malformedDropped > 0) {
    console.warn(`[fetchOffers] dropped ${malformedDropped} malformed ${provider} offer(s)`);
  }
  return mapped;
};
