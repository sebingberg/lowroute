import { type Env, readEnv } from "@lowroute/config";
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
  readonly offers: NormalizedProviderOffer[];
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
  const results = await Promise.all(
    PROVIDER_ORDER.map((provider) =>
      runProbe(provider, probes[provider], input, deps, apiKeyFor(env, provider)),
    ),
  );

  return {
    offers: results.flatMap((result) =>
      result instanceof ProviderRequestError ? [] : result.offers,
    ),
    errors: results.filter(
      (result): result is ProviderRequestError => result instanceof ProviderRequestError,
    ),
  };
};
