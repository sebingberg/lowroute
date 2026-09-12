import { describe, expect, it, vi } from "vitest";

import { kiwiProbe } from "./probe.js";

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

describe("kiwiProbe", () => {
  it("queries Tequila with dd/mm/yyyy dates and maps risk flags", async () => {
    const fetchImpl = stubFetch({
      data: [
        {
          id: "itinerary-1",
          price: 621,
          pnr_count: 2,
          has_airport_change: false,
          route: [
            {
              dTimeUTC: 1780279200,
              aTimeUTC: 1780286400,
              vi_connection: true,
              bags_recheck_required: false,
            },
            {
              dTimeUTC: 1780297200,
              aTimeUTC: 1780308000,
              vi_connection: false,
              bags_recheck_required: false,
            },
          ],
        },
        { id: "broken", price: -5, route: [] },
      ],
    });

    const result = await kiwiProbe.run(request, {
      apiKey: "tequila-key",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit & { headers: Record<string, string> },
    ];
    expect(url).toContain("https://api.tequila.kiwi.com/v2/search?");
    expect(url).toContain("fly_from=EZE");
    expect(url).toContain("date_from=01%2F10%2F2026");
    expect(url).toContain("return_from=15%2F10%2F2026");
    expect(url).toContain("selected_cabins=M");
    expect(init.headers.apikey).toBe("tequila-key");

    expect(result.provider).toBe("kiwi");
    expect(result.offers).toHaveLength(1);
    const [offer] = result.offers;
    expect(offer?.quoted_amount).toBe(621);
    expect(offer?.currency).toBe("USD");
    expect(offer?.merchant_country).toBe("CZ");
    expect(offer?.raw_ref).toBe("kiwi:itinerary-1");
    expect(offer?.risk.self_transfer).toBe(true);
    expect(offer?.risk.separate_tickets).toBe(true);
    expect(offer?.risk.connection_minutes_min).toBe(180);
  });

  it("ignores the turnaround gap between outbound and return legs", async () => {
    const fetchImpl = stubFetch({
      data: [
        {
          id: "itinerary-roundtrip",
          price: 600,
          pnr_count: 1,
          has_airport_change: false,
          route: [
            { return: 0, dTimeUTC: 1780279200, aTimeUTC: 1780286400 },
            // ! Two-week turnaround: must not count as a connection.
            { return: 1, dTimeUTC: 1781493600, aTimeUTC: 1781500800 },
          ],
        },
      ],
    });

    const result = await kiwiProbe.run(request, {
      apiKey: "tequila-key",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.offers).toHaveLength(1);
    const [offer] = result.offers;
    expect(offer?.risk.connection_minutes_min).toBe(0);
    expect(offer?.risk.overnight_layover).toBe(false);
    expect(offer?.risk.self_transfer).toBe(false);
  });

  it("rejects malformed search dates as invalid requests", async () => {
    const fetchImpl = stubFetch({ data: [] });

    await expect(
      kiwiProbe.run(
        { ...request, departure_date: "20261001" },
        { apiKey: "key", fetchImpl: fetchImpl as unknown as typeof fetch },
      ),
    ).rejects.toMatchObject({
      code: "invalid_request",
      retryable: false,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("drops itineraries whose longest layover exceeds max_layover_hours", async () => {
    const fetchImpl = stubFetch({
      data: [
        {
          id: "over-cap",
          price: 500,
          pnr_count: 1,
          route: [
            { dTimeUTC: 1780279200, aTimeUTC: 1780286400 },
            // ! 1320 min exceeds the 8h cap.
            { dTimeUTC: 1780365600, aTimeUTC: 1780376400 },
          ],
        },
        {
          id: "at-cap",
          price: 600,
          pnr_count: 1,
          route: [
            { dTimeUTC: 1780279200, aTimeUTC: 1780286400 },
            // ! Exactly 480 min stays.
            { dTimeUTC: 1780315200, aTimeUTC: 1780318800 },
          ],
        },
      ],
    });

    const result = await kiwiProbe.run(request, {
      apiKey: "tequila-key",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.offers.map((offer) => offer.id)).toEqual(["at-cap"]);
  });

  it("throws missing_credentials when no key is configured", async () => {
    const saved = process.env.KIWI_API_KEY;
    delete process.env.KIWI_API_KEY;
    try {
      await expect(kiwiProbe.run(request)).rejects.toMatchObject({
        name: "ProviderRequestError",
        code: "missing_credentials",
      });
    } finally {
      if (saved !== undefined) {
        process.env.KIWI_API_KEY = saved;
      }
    }
  });

  it("maps auth failures and malformed payloads to the shared error shape", async () => {
    const unauthorized = stubFetch({ message: "forbidden" }, 403);
    await expect(
      kiwiProbe.run(request, { apiKey: "bad", fetchImpl: unauthorized as unknown as typeof fetch }),
    ).rejects.toMatchObject({
      code: "auth",
      retryable: false,
    });

    const malformed = stubFetch({ data: { unexpected: true } });
    await expect(
      kiwiProbe.run(request, { apiKey: "key", fetchImpl: malformed as unknown as typeof fetch }),
    ).rejects.toMatchObject({
      code: "bad_response",
    });
  });
});
