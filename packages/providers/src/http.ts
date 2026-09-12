import { type ProviderName, ProviderRequestError } from "./types.js";

// ! Default probe timeout stays above Duffel supplier latency but below queue visibility timeouts.
export const DEFAULT_PROVIDER_TIMEOUT_MS = 15_000;

export type ProviderHttpRequest = {
  readonly provider: ProviderName;
  readonly method: "GET" | "POST";
  readonly headers: Record<string, string>;
  readonly body?: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
};

const isTimeoutError = (error: unknown): boolean =>
  error instanceof Error && error.name === "TimeoutError";

// ! Travelpayouts carries its token as a query param, so error messages must
// ! never echo raw URLs; fetch still receives the untouched URL.
export const redactUrl = (url: string): string =>
  url.replace(/([?&](?:token|apikey|api_key|access_key|secret|signature|key)=)[^&]*/gi, "$1***");

const statusToError = (
  provider: ProviderName,
  url: string,
  status: number,
): ProviderRequestError => {
  if (status === 401 || status === 403) {
    return new ProviderRequestError({
      provider,
      code: "auth",
      message: `${provider} rejected credentials (status ${status}) for ${url}`,
      status,
    });
  }
  if (status === 429) {
    return new ProviderRequestError({
      provider,
      code: "rate_limited",
      message: `${provider} rate limited (status 429) for ${url}`,
      status,
    });
  }
  // ! Response bodies are stripped: providers may echo request creds in error payloads.
  return new ProviderRequestError({
    provider,
    code: "bad_response",
    message: `${provider} request failed (status ${status}) for ${url}`,
    status,
    retryable: status >= 500,
  });
};

/** Single JSON fetch helper every live probe uses so auth/timeout/mapping errors share one shape. */
export const requestJson = async <T>(url: string, init: ProviderHttpRequest): Promise<T> => {
  const timeoutMs = init.timeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS;
  const fetchImpl = init.fetchImpl ?? fetch;
  const safeUrl = redactUrl(url);

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: init.method,
      headers: init.headers,
      body: init.body,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (isTimeoutError(error)) {
      throw new ProviderRequestError({
        provider: init.provider,
        code: "timeout",
        message: `${init.provider} request timed out after ${timeoutMs}ms for ${safeUrl}`,
        cause: error,
      });
    }
    throw new ProviderRequestError({
      provider: init.provider,
      code: "unavailable",
      message: `${init.provider} request failed for ${safeUrl}`,
      cause: error,
    });
  }

  if (!response.ok) {
    throw statusToError(init.provider, safeUrl, response.status);
  }

  try {
    return (await response.json()) as T;
  } catch (error) {
    // ! AbortSignal.timeout also fires while the body streams, so a timeout
    // ! during response.json() must stay retryable instead of bad_response.
    if (isTimeoutError(error)) {
      throw new ProviderRequestError({
        provider: init.provider,
        code: "timeout",
        message: `${init.provider} request timed out after ${timeoutMs}ms for ${safeUrl}`,
        cause: error,
      });
    }
    throw new ProviderRequestError({
      provider: init.provider,
      code: "bad_response",
      message: `${init.provider} returned invalid JSON for ${safeUrl}`,
      status: response.status,
      retryable: false,
      cause: error,
    });
  }
};

/** Resolve a provider credential from explicit options or its env var; never hardcode keys. */
export const resolveApiKey = (
  provider: ProviderName,
  envVar: string,
  apiKey: string | undefined,
): string => {
  const configured = apiKey ?? process.env[envVar];
  if (!configured) {
    throw new ProviderRequestError({
      provider,
      code: "missing_credentials",
      message: `${envVar} is not set`,
    });
  }
  return configured;
};
