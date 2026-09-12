import { describe, expect, it, vi } from "vitest";

import { fetchOffers } from "./fetch-offers.js";

const search = {
  origin: "EZE",
  destination: "MAD",
  departure_date: "2026-10-01",
  return_date: "2026-10-15",
  cabin: "economy" as const,
  adults: 1 as const,
  max_layover_hours: 8,
};

const offerFor = (provider: "duffel" | "kiwi" | "travelpayouts", id: string) => ({
  provider,
  id,
  origin: search.origin,
  destination: search.destination,
  departure_date: search.departure_date,
  return_date: search.return_date,
  merchant_country: "XX",
  currency: "USD",
  quoted_amount: 500,
  risk: {
    self_transfer: false,
    separate_tickets: false,
    airport_change: false,
    overnight_layover: false,
    checked_bag_included: false,
    carry_on_included: true,
    connection_minutes_min: 0,
  },
  raw_ref: `${provider}:${id}`,
});

const stubProbe = (provider: "duffel" | "kiwi" | "travelpayouts", ids: string[]) => ({
  run: vi.fn(async () => ({
    provider,
    searched_at_utc: "2026-09-12T00:00:00.000Z",
    request: search,
    offers: ids.map((id) => offerFor(provider, id)),
  })),
});

const env = {
  DUFFEL_API_KEY: "duffel-key",
  KIWI_API_KEY: "kiwi-key",
  TRAVELPAYOUTS_TOKEN: "tp-token",
};

describe("fetchOffers", () => {
  it("fans out to every provider and merges offers in provider order", async () => {
    const probes = {
      duffel: stubProbe("duffel", ["d1"]),
      kiwi: stubProbe("kiwi", ["k1", "k2"]),
      travelpayouts: stubProbe("travelpayouts", ["t1"]),
    };

    const output = await fetchOffers({ search }, { probes, env });

    expect(output.errors).toEqual([]);
    expect(output.offers.map((offer) => offer.id)).toEqual(["d1", "k1", "k2", "t1"]);
    expect(probes.duffel.run).toHaveBeenCalledWith(
      search,
      expect.objectContaining({ apiKey: "duffel-key" }),
    );
    expect(probes.kiwi.run).toHaveBeenCalledWith(
      search,
      expect.objectContaining({ apiKey: "kiwi-key" }),
    );
    expect(probes.travelpayouts.run).toHaveBeenCalledWith(
      search,
      expect.objectContaining({ apiKey: "tp-token" }),
    );
  });

  it("keeps other providers offers when one probe fails", async () => {
    const failing = {
      run: vi.fn(async () => {
        throw new Error("kiwi exploded");
      }),
    };
    const probes = {
      duffel: stubProbe("duffel", ["d1"]),
      kiwi: failing,
      travelpayouts: stubProbe("travelpayouts", ["t1"]),
    };

    const output = await fetchOffers({ search }, { probes, env });

    expect(output.offers.map((offer) => offer.id)).toEqual(["d1", "t1"]);
    expect(output.errors).toHaveLength(1);
    expect(output.errors[0]?.provider).toBe("kiwi");
    expect(output.errors[0]?.code).toBe("unavailable");
  });

  it("returns missing_credentials for every provider when no keys are configured", async () => {
    const fetchImpl = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit): Promise<Response> => {
        throw new Error("unit tests must not touch the network");
      },
    );

    const output = await fetchOffers(
      { search },
      {
        env: { DUFFEL_API_KEY: "", KIWI_API_KEY: "", TRAVELPAYOUTS_TOKEN: "" },
        probeOptions: { fetchImpl: fetchImpl as unknown as typeof fetch },
      },
    );

    expect(output.offers).toEqual([]);
    expect(output.errors.map((error) => error.code)).toEqual([
      "missing_credentials",
      "missing_credentials",
      "missing_credentials",
    ]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
