import { describe, expect, it } from "vitest";

import {
  exceedsLayoverCap,
  type NormalizedSearchRequest,
  normalizeCurrencyCode,
  ProviderRequestError,
} from "./types.js";

describe("ProviderRequestError", () => {
  it("derives retryable from the error code by default", () => {
    expect(
      new ProviderRequestError({ provider: "duffel", code: "timeout", message: "slow" }).retryable,
    ).toBe(true);
    expect(
      new ProviderRequestError({ provider: "kiwi", code: "auth", message: "denied" }).retryable,
    ).toBe(false);
    expect(
      new ProviderRequestError({
        provider: "travelpayouts",
        code: "missing_credentials",
        message: "no key",
      }).retryable,
    ).toBe(false);
  });

  it("keeps status and honors explicit retryable override", () => {
    const error = new ProviderRequestError({
      provider: "duffel",
      code: "bad_response",
      message: "boom",
      status: 503,
      retryable: true,
    });

    expect(error.name).toBe("ProviderRequestError");
    expect(error.status).toBe(503);
    expect(error.retryable).toBe(true);
    expect(error.provider).toBe("duffel");
  });
});

describe("normalizeCurrencyCode", () => {
  it("uppercases valid codes and rejects the rest", () => {
    expect(normalizeCurrencyCode("usd")).toBe("USD");
    expect(normalizeCurrencyCode("USD")).toBe("USD");
    expect(normalizeCurrencyCode("us")).toBeUndefined();
    expect(normalizeCurrencyCode("USDD")).toBeUndefined();
    expect(normalizeCurrencyCode("")).toBeUndefined();
    expect(normalizeCurrencyCode(123)).toBeUndefined();
    expect(normalizeCurrencyCode(undefined)).toBeUndefined();
  });
});

describe("exceedsLayoverCap", () => {
  const request: NormalizedSearchRequest = {
    origin: "EZE",
    destination: "MAD",
    departure_date: "2026-10-01",
    return_date: "2026-10-15",
    cabin: "economy",
    adults: 1,
    max_layover_hours: 8,
  };

  it("drops only itineraries strictly over the cap", () => {
    expect(exceedsLayoverCap(request, [])).toBe(false);
    expect(exceedsLayoverCap(request, [60, 480])).toBe(false);
    expect(exceedsLayoverCap(request, [60, 481])).toBe(true);
  });
});
