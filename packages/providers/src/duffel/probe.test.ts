import { describe, expect, it, vi } from "vitest";

import type { ProviderRequestError } from "../types.js";
import { duffelProbe } from "./probe.js";

const request = {
  origin: "EZE",
  destination: "MAD",
  departure_date: "2026-10-01",
  return_date: "2026-10-15",
  cabin: "economy" as const,
  adults: 1 as const,
  max_layover_hours: 8,
};

const offerResponse = (offers: unknown[]) => ({
  data: { id: "orq_123", offers },
});

const segment = (from: string, to: string, departing_at: string, arriving_at: string) => ({
  origin: { iata_code: from },
  destination: { iata_code: to },
  departing_at,
  arriving_at,
});

const stubFetch = (payload: unknown, init?: { status?: number; ok?: boolean }) => {
  const status = init?.status ?? 200;
  return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => ({
    ok: init?.ok ?? (status >= 200 && status < 300),
    status,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  }));
};

describe("duffelProbe", () => {
  it("posts a round-trip offer request and maps the cheapest offers first", async () => {
    const fetchImpl = stubFetch(
      offerResponse([
        {
          id: "off_expensive",
          total_amount: "1200.00",
          total_currency: "usd",
          slices: [
            { segments: [segment("EZE", "MAD", "2026-10-01T10:00:00Z", "2026-10-01T23:00:00Z")] },
          ],
        },
        {
          id: "off_cheap",
          total_amount: "699.50",
          total_currency: "USD",
          slices: [
            {
              segments: [
                segment("EZE", "GRU", "2026-10-01T18:00:00Z", "2026-10-01T21:00:00Z"),
                segment("GIG", "MAD", "2026-10-02T00:00:00Z", "2026-10-02T13:00:00Z"),
              ],
            },
          ],
        },
      ]),
    );

    const result = await duffelProbe.run(request, {
      apiKey: "test-key",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit & { headers: Record<string, string> },
    ];
    expect(url).toBe("https://api.duffel.com/air/offer_requests");
    expect(init.headers.authorization).toBe("Bearer test-key");
    expect(init.headers["duffel-version"]).toBe("v2");
    const body = JSON.parse(init.body as string) as {
      data: { slices: unknown[]; cabin_class: string };
    };
    expect(body.data.slices).toHaveLength(2);
    expect(body.data.cabin_class).toBe("economy");

    expect(result.provider).toBe("duffel");
    expect(result.offers).toHaveLength(2);
    const [cheap, expensive] = result.offers;
    expect(cheap?.id).toBe("off_cheap");
    expect(cheap?.quoted_amount).toBe(699.5);
    expect(cheap?.currency).toBe("USD");
    expect(cheap?.raw_ref).toBe("duffel:orq_123:off_cheap");
    expect(cheap?.risk.airport_change).toBe(true);
    expect(cheap?.risk.overnight_layover).toBe(true);
    expect(cheap?.risk.connection_minutes_min).toBe(180);
    expect(expensive?.risk.connection_minutes_min).toBe(0);
  });

  it("ignores the turnaround gap between outbound and return slices", async () => {
    const fetchImpl = stubFetch(
      offerResponse([
        {
          id: "off_roundtrip",
          total_amount: "800.00",
          total_currency: "USD",
          slices: [
            {
              segments: [
                segment("EZE", "GRU", "2026-10-01T10:00:00Z", "2026-10-01T13:00:00Z"),
                segment("GRU", "MAD", "2026-10-01T14:00:00Z", "2026-10-01T23:00:00Z"),
              ],
            },
            {
              segments: [segment("MAD", "EZE", "2026-10-15T10:00:00Z", "2026-10-15T22:00:00Z")],
            },
          ],
        },
      ]),
    );

    const result = await duffelProbe.run(request, {
      apiKey: "test-key",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.offers).toHaveLength(1);
    const [offer] = result.offers;
    expect(offer?.risk.connection_minutes_min).toBe(60);
    expect(offer?.risk.overnight_layover).toBe(false);
    expect(offer?.risk.airport_change).toBe(false);
  });

  it("drops offers whose longest layover exceeds max_layover_hours", async () => {
    const fetchImpl = stubFetch(
      offerResponse([
        {
          id: "off_long_layover",
          total_amount: "500.00",
          total_currency: "USD",
          slices: [
            {
              segments: [
                segment("EZE", "GRU", "2026-10-01T10:00:00Z", "2026-10-01T13:00:00Z"),
                segment("GRU", "MAD", "2026-10-02T10:00:00Z", "2026-10-02T23:00:00Z"),
              ],
            },
          ],
        },
        {
          id: "off_at_cap",
          total_amount: "600.00",
          total_currency: "USD",
          slices: [
            {
              segments: [
                segment("EZE", "GRU", "2026-10-01T10:00:00Z", "2026-10-01T13:00:00Z"),
                segment("GRU", "MAD", "2026-10-01T21:00:00Z", "2026-10-02T10:00:00Z"),
              ],
            },
          ],
        },
      ]),
    );

    const result = await duffelProbe.run(request, {
      apiKey: "test-key",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    // ! 1260 min exceeds the 8h cap; exactly 480 min stays.
    expect(result.offers.map((offer) => offer.id)).toEqual(["off_at_cap"]);
  });

  it("skips malformed offers instead of failing the probe", async () => {
    const fetchImpl = stubFetch(
      offerResponse([{ id: "", total_amount: "abc", total_currency: "USD" }]),
    );

    const result = await duffelProbe.run(request, {
      apiKey: "test-key",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.offers).toEqual([]);
  });

  it("throws missing_credentials when no key is configured", async () => {
    const saved = process.env.DUFFEL_API_KEY;
    delete process.env.DUFFEL_API_KEY;
    try {
      await expect(duffelProbe.run(request)).rejects.toMatchObject({
        name: "ProviderRequestError",
        code: "missing_credentials",
      });
    } finally {
      if (saved !== undefined) {
        process.env.DUFFEL_API_KEY = saved;
      }
    }
  });

  it("maps auth, rate limit, and timeout failures to the shared error shape", async () => {
    const unauthorized = stubFetch({ message: "unauthorized" }, { status: 401 });
    await expect(
      duffelProbe.run(request, {
        apiKey: "bad",
        fetchImpl: unauthorized as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({
      code: "auth",
      retryable: false,
    } satisfies Partial<ProviderRequestError>);

    const limited = stubFetch({ message: "slow down" }, { status: 429 });
    await expect(
      duffelProbe.run(request, { apiKey: "key", fetchImpl: limited as unknown as typeof fetch }),
    ).rejects.toMatchObject({
      code: "rate_limited",
      retryable: true,
    } satisfies Partial<ProviderRequestError>);

    const timeoutError = Object.assign(new Error("timed out"), { name: "TimeoutError" });
    const timingOut = vi.fn(async () => {
      throw timeoutError;
    }) as unknown as typeof fetch;
    await expect(
      duffelProbe.run(request, { apiKey: "key", fetchImpl: timingOut }),
    ).rejects.toMatchObject({
      code: "timeout",
      retryable: true,
    } satisfies Partial<ProviderRequestError>);
  });

  it("rejects responses without data.offers", async () => {
    const fetchImpl = stubFetch({ data: {} });

    await expect(
      duffelProbe.run(request, { apiKey: "key", fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toMatchObject({
      code: "bad_response",
    } satisfies Partial<ProviderRequestError>);
  });
});
