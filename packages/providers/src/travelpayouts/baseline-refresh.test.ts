import type { BaselineStats } from "@lowroute/domain";
import { describe, expect, it, vi } from "vitest";

import { refreshTravelpayoutsBaseline } from "./baseline-refresh.js";

const stubFetch = (payload: unknown, status = 200) => {
  return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  }));
};

const calendarPayload = {
  success: true,
  currency: "USD",
  data: {
    "2026-10-01": { origin: "EZE", destination: "MAD", price: 500 },
    "2026-10-08": { origin: "EZE", destination: "MAD", price: 300 },
    "2026-10-15": { origin: "EZE", destination: "MAD", price: 400 },
    "2026-10-22": { origin: "EZE", destination: "MAD", price: 200 },
    "2026-10-29": { origin: "EZE", destination: "MAD", price: 100 },
  },
};

describe("refreshTravelpayoutsBaseline", () => {
  it("persists the parsed baseline row and returns stats", async () => {
    const fetchImpl = stubFetch(calendarPayload);
    const upsert = vi.fn(async (_baseline: BaselineStats) => undefined);

    const stats = await refreshTravelpayoutsBaseline(
      { origin: "EZE", destination: "MAD", month: "2026-10" },
      { apiKey: "tp-token", fetchImpl: fetchImpl as unknown as typeof fetch, upsert },
    );

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("https://api.travelpayouts.com/v1/prices/calendar?");
    expect(url).toContain("calendar_type=departure_date");

    // ! Same reference vector as baseline-adapter.test.ts: p20 interpolates to 180.
    expect(stats.route_key).toBe("EZE-MAD");
    expect(stats.sample_size).toBe(5);
    expect(stats.p20.amount).toBe(180);
    expect(stats.median.amount).toBe(300);
    expect(upsert).toHaveBeenCalledOnce();
    expect(upsert.mock.calls[0]?.[0]?.route_key).toBe("EZE-MAD");
  });

  it("rejects non-USD calendars instead of mislabeling Money", async () => {
    const fetchImpl = stubFetch({ ...calendarPayload, currency: "RUB" });
    const upsert = vi.fn(async (_baseline: BaselineStats) => undefined);

    await expect(
      refreshTravelpayoutsBaseline(
        { origin: "EZE", destination: "MAD", month: "2026-10" },
        { apiKey: "tp-token", fetchImpl: fetchImpl as unknown as typeof fetch, upsert },
      ),
    ).rejects.toMatchObject({ code: "invalid_request", retryable: false });
    expect(upsert).not.toHaveBeenCalled();
  });

  it.each(["", "US", "USDD", 123])("rejects malformed currency %p", async (currency) => {
    const fetchImpl = stubFetch({ ...calendarPayload, currency });
    const upsert = vi.fn(async (_baseline: BaselineStats) => undefined);

    await expect(
      refreshTravelpayoutsBaseline(
        { origin: "EZE", destination: "MAD", month: "2026-10" },
        { apiKey: "tp-token", fetchImpl: fetchImpl as unknown as typeof fetch, upsert },
      ),
    ).rejects.toMatchObject({ code: "invalid_request" });
    expect(upsert).not.toHaveBeenCalled();
  });

  it("defaults to USD when the currency field is absent", async () => {
    const { currency: _omitted, ...payloadWithoutCurrency } = calendarPayload;
    const fetchImpl = stubFetch(payloadWithoutCurrency);
    const upsert = vi.fn(async (_baseline: BaselineStats) => undefined);

    const stats = await refreshTravelpayoutsBaseline(
      { origin: "EZE", destination: "MAD", month: "2026-10" },
      { apiKey: "tp-token", fetchImpl: fetchImpl as unknown as typeof fetch, upsert },
    );

    expect(stats.route_key).toBe("EZE-MAD");
    expect(upsert).toHaveBeenCalledOnce();
  });

  it("accepts lowercase usd calendars", async () => {
    const fetchImpl = stubFetch({ ...calendarPayload, currency: "usd" });
    const upsert = vi.fn(async (_baseline: BaselineStats) => undefined);

    const stats = await refreshTravelpayoutsBaseline(
      { origin: "EZE", destination: "MAD", month: "2026-10" },
      { apiKey: "tp-token", fetchImpl: fetchImpl as unknown as typeof fetch, upsert },
    );

    expect(stats.route_key).toBe("EZE-MAD");
    expect(upsert).toHaveBeenCalledOnce();
  });

  it("rejects malformed months as invalid requests without calling the API", async () => {
    const fetchImpl = stubFetch(calendarPayload);
    const upsert = vi.fn(async (_baseline: BaselineStats) => undefined);

    for (const month of ["october", "2026-00", "2026-13", "2026-1"]) {
      await expect(
        refreshTravelpayoutsBaseline(
          { origin: "EZE", destination: "MAD", month },
          { apiKey: "tp-token", fetchImpl: fetchImpl as unknown as typeof fetch, upsert },
        ),
      ).rejects.toMatchObject({ code: "invalid_request", retryable: false });
    }
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it("rejects payloads for another route before persisting", async () => {
    const mistargeted = {
      ...calendarPayload,
      data: {
        "2026-10-01": { origin: "EZE", destination: "BCN", price: 500 },
        "2026-10-08": { origin: "EZE", destination: "BCN", price: 300 },
        "2026-10-15": { origin: "EZE", destination: "BCN", price: 400 },
      },
    };
    const fetchImpl = stubFetch(mistargeted);
    const upsert = vi.fn(async (_baseline: BaselineStats) => undefined);

    await expect(
      refreshTravelpayoutsBaseline(
        { origin: "EZE", destination: "MAD", month: "2026-10" },
        { apiKey: "tp-token", fetchImpl: fetchImpl as unknown as typeof fetch, upsert },
      ),
    ).rejects.toMatchObject({ code: "bad_response", retryable: false });
    expect(upsert).not.toHaveBeenCalled();
  });

  it("wraps unparseable payloads in the shared error shape", async () => {
    const fetchImpl = stubFetch({ success: false, data: {} });
    const upsert = vi.fn(async (_baseline: BaselineStats) => undefined);

    await expect(
      refreshTravelpayoutsBaseline(
        { origin: "EZE", destination: "MAD", month: "2026-10" },
        { apiKey: "tp-token", fetchImpl: fetchImpl as unknown as typeof fetch, upsert },
      ),
    ).rejects.toMatchObject({ name: "ProviderRequestError", code: "bad_response" });
    expect(upsert).not.toHaveBeenCalled();
  });
});
