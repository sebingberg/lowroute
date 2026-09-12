import { describe, expect, it, vi } from "vitest";

import { travelpayoutsProbe } from "./probe.js";

const request = {
  origin: "EZE",
  destination: "MAD",
  departure_date: "2026-10-01",
  return_date: "2026-10-15",
  cabin: "economy" as const,
  adults: 1 as const,
  max_layover_hours: 8,
};

const stubFetch = (payload: unknown, status = 200) => {
  return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  }));
};

describe("travelpayoutsProbe", () => {
  it("fetches cheapest dates and maps the lowest price first", async () => {
    const fetchImpl = stubFetch({
      success: true,
      currency: "USD",
      data: {
        MAD: {
          "0": { price: 745, airline: "UX", departure_at: "2026-10-01T10:00:00Z" },
          "1": { price: 690, airline: "AR", departure_at: "2026-10-08T10:00:00Z" },
          "2": { price: "junk" },
        },
        LON: {
          "0": { price: 100 },
        },
      },
    });

    const result = await travelpayoutsProbe.run(request, {
      apiKey: "tp-token",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("https://api.travelpayouts.com/v1/prices/cheap?");
    expect(url).toContain("origin=EZE");
    expect(url).toContain("destination=MAD");
    expect(url).toContain("depart_date=2026-10");
    expect(url).toContain("token=tp-token");

    expect(result.provider).toBe("travelpayouts");
    expect(result.offers).toHaveLength(2);
    const [cheap, expensive] = result.offers;
    expect(cheap?.quoted_amount).toBe(690);
    expect(cheap?.currency).toBe("USD");
    expect(cheap?.raw_ref).toBe("travelpayouts:cheap:EZE-MAD:2026-10-08");
    expect(expensive?.quoted_amount).toBe(745);
  });

  it("carries the priced departure date instead of the requested date", async () => {
    const fetchImpl = stubFetch({
      success: true,
      currency: "USD",
      data: {
        MAD: {
          "0": { price: 745, airline: "UX", departure_at: "2026-10-01T10:00:00Z" },
          "1": { price: 690, airline: "AR", departure_at: "2026-10-08T10:00:00Z" },
          "2": { price: 500, airline: "LA" },
        },
      },
    });

    const result = await travelpayoutsProbe.run(request, {
      apiKey: "tp-token",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    // ! The dateless entry falls back to its position key, which is not a
    // ! date, so only the two dated entries map.
    expect(result.offers.map((offer) => offer.departure_date)).toEqual([
      "2026-10-08",
      "2026-10-01",
    ]);
  });

  it("uppercases a lowercase response currency", async () => {
    const fetchImpl = stubFetch({
      success: true,
      currency: "usd",
      data: {
        MAD: {
          "0": { price: 690, airline: "AR", departure_at: "2026-10-08T10:00:00Z" },
        },
      },
    });

    const result = await travelpayoutsProbe.run(request, {
      apiKey: "tp-token",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.offers).toHaveLength(1);
    expect(result.offers[0]?.currency).toBe("USD");
  });

  it("throws missing_credentials when no token is configured", async () => {
    const saved = process.env.TRAVELPAYOUTS_TOKEN;
    delete process.env.TRAVELPAYOUTS_TOKEN;
    try {
      await expect(travelpayoutsProbe.run(request)).rejects.toMatchObject({
        name: "ProviderRequestError",
        code: "missing_credentials",
      });
    } finally {
      if (saved !== undefined) {
        process.env.TRAVELPAYOUTS_TOKEN = saved;
      }
    }
  });

  it("rejects unsuccessful payloads", async () => {
    const fetchImpl = stubFetch({ success: false, data: {} });

    await expect(
      travelpayoutsProbe.run(request, {
        apiKey: "token",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ code: "bad_response" });
  });
});
