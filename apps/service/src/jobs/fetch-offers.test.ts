import type { ProviderOfferInput } from "@lowroute/domain";
import type { NormalizedProviderOffer } from "@lowroute/providers";
import { describe, expect, it, vi } from "vitest";

import { fetchOffers } from "./fetch-offers.js";

// ! Compile-time sync guard for the hand-copied ProviderOfferInput shape (see
// ! packages/domain/src/services/provider-offer-adapter.ts): every input field
// ! except provider (intentionally widened from ProviderName to string) must
// ! exist with a mutually-assignable type on NormalizedProviderOffer. A drifted
// ! key or type fails the extends-never constraint below at typecheck time.
type _InputFields = Omit<ProviderOfferInput, "provider">;
type _ExtraKeys = Exclude<keyof _InputFields, keyof NormalizedProviderOffer>;
type _MismatchedKeys = keyof {
  [K in keyof _InputFields as K extends keyof NormalizedProviderOffer
    ? _InputFields[K] extends NormalizedProviderOffer[K]
      ? NormalizedProviderOffer[K] extends _InputFields[K]
        ? never
        : K
      : K
    : K]: 1;
};
type _AssertNever<T extends never> = T;
type _NoExtraKeys = _AssertNever<_ExtraKeys>;
type _NoMismatchedKeys = _AssertNever<_MismatchedKeys>;
const _syncGuard: readonly [_NoExtraKeys | null, _NoMismatchedKeys | null] | null = null;
void _syncGuard;

const search = {
  origin: "EZE",
  destination: "MAD",
  departure_date: "2026-10-01",
  return_date: "2026-10-15",
  cabin: "economy" as const,
  adults: 1 as const,
  max_layover_hours: 8,
};

const offerFor = (
  provider: "duffel" | "kiwi" | "travelpayouts",
  id: string,
  connectionMinutesMin = 0,
) => ({
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
    connection_minutes_min: connectionMinutesMin,
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
  it("fans out to every provider and maps offers to NormalizedOffer", async () => {
    const probes = {
      duffel: stubProbe("duffel", ["d1"]),
      kiwi: stubProbe("kiwi", ["k1", "k2"]),
      travelpayouts: stubProbe("travelpayouts", ["t1"]),
    };

    const output = await fetchOffers({ search }, { probes, env });

    expect(output.errors).toEqual([]);
    expect(output.offers.map((offer) => offer.provider)).toEqual([
      "duffel",
      "kiwi",
      "kiwi",
      "travelpayouts",
    ]);
    expect(output.offers[0]).toMatchObject({
      origin: "EZE",
      destination: "MAD",
      destination_tier: "medium",
      trip_days: 14,
      cabin: "economy",
      max_layover_hours: 8,
      merchant_country: "XX",
      payment_path: "foreign_card",
      score: 0,
    });
    expect(output.offers[0]?.quoted_price.amount).toBe(500);
    expect(output.offers[0]?.quoted_price.currency).toBe("USD");
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

  it("passes through long minimum connections (layover cap is probe-side duty)", async () => {
    // ! connection_minutes_min is the SHORTEST connection, so the adapter must
    // ! not treat it as a maximum. Probes drop over-cap itineraries on the
    // ! full layover list (exceedsLayoverCap); stub probes bypass that stage,
    // ! so a 481-minute minimum survives mapping here by design.
    const longMinimum = {
      run: vi.fn(async () => ({
        provider: "kiwi" as const,
        searched_at_utc: "2026-09-12T00:00:00.000Z",
        request: search,
        offers: [offerFor("kiwi", "k-long", 481)],
      })),
    };
    const probes = {
      duffel: stubProbe("duffel", ["d1"]),
      kiwi: longMinimum,
      travelpayouts: stubProbe("travelpayouts", ["t1"]),
    };

    const output = await fetchOffers({ search }, { probes, env });

    expect(output.errors).toEqual([]);
    expect(output.offers.map((offer) => offer.provider)).toEqual([
      "duffel",
      "kiwi",
      "travelpayouts",
    ]);
    expect(
      output.offers.find((offer) => offer.provider === "kiwi")?.connection_minutes_min,
    ).toBe(481);
  });

  it("maps AR merchant offers to foreign_card through the chain", async () => {
    const arOffer = { ...offerFor("duffel", "d-ar"), merchant_country: "ar" };
    const probes = {
      duffel: {
        run: vi.fn(async () => ({
          provider: "duffel" as const,
          searched_at_utc: "2026-09-12T00:00:00.000Z",
          request: search,
          offers: [arOffer],
        })),
      },
      kiwi: stubProbe("kiwi", []),
      travelpayouts: stubProbe("travelpayouts", []),
    };

    const output = await fetchOffers({ search }, { probes, env });

    expect(output.errors).toEqual([]);
    expect(output.offers).toHaveLength(1);
    expect(output.offers[0]).toMatchObject({
      merchant_country: "AR",
      payment_path: "foreign_card",
    });
    expect(output.offers[0]?.ar_exception_class).toBeUndefined();
  });

  it("drops non-USD probe offers instead of converting without FX", async () => {
    const arsOffer = { ...offerFor("kiwi", "k-ars"), currency: "ARS", quoted_amount: 100_000 };
    const probes = {
      duffel: stubProbe("duffel", ["d1"]),
      kiwi: {
        run: vi.fn(async () => ({
          provider: "kiwi" as const,
          searched_at_utc: "2026-09-12T00:00:00.000Z",
          request: search,
          offers: [arsOffer],
        })),
      },
      travelpayouts: stubProbe("travelpayouts", ["t1"]),
    };

    const output = await fetchOffers({ search }, { probes, env });

    expect(output.errors).toEqual([]);
    expect(output.offers.map((offer) => offer.provider)).toEqual(["duffel", "travelpayouts"]);
  });

  it("drops zero and negative quotes silently (no malformed warn)", async () => {
    const probes = {
      duffel: stubProbe("duffel", ["d1"]),
      kiwi: {
        run: vi.fn(async () => ({
          provider: "kiwi" as const,
          searched_at_utc: "2026-09-12T00:00:00.000Z",
          request: search,
          offers: [
            { ...offerFor("kiwi", "k-zero"), quoted_amount: 0 },
            { ...offerFor("kiwi", "k-neg"), quoted_amount: -50 },
          ],
        })),
      },
      travelpayouts: stubProbe("travelpayouts", ["t1"]),
    };

    const output = await fetchOffers({ search }, { probes, env });

    expect(output.errors).toEqual([]);
    expect(output.offers.map((offer) => offer.provider)).toEqual(["duffel", "travelpayouts"]);
  });

  it("warns once per provider batch when structurally malformed offers drop", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      // ! Zero/negative/non-finite quotes and non-USD currency return null
      // ! (silent data drops); only a throw inside the adapter (here: a
      // ! non-string destination) counts as malformed and warns.
      const malformed = { ...offerFor("kiwi", "k-bad"), destination: 42 as unknown as string };
      const probes = {
        duffel: stubProbe("duffel", ["d1"]),
        kiwi: {
          run: vi.fn(async () => ({
            provider: "kiwi" as const,
            searched_at_utc: "2026-09-12T00:00:00.000Z",
            request: search,
            offers: [malformed],
          })),
        },
        travelpayouts: stubProbe("travelpayouts", ["t1"]),
      };

      const output = await fetchOffers({ search }, { probes, env });

      expect(output.offers.map((offer) => offer.provider)).toEqual(["duffel", "travelpayouts"]);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("dropped 1 malformed kiwi offer(s)"),
      );
    } finally {
      warn.mockRestore();
    }
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

    expect(output.offers.map((offer) => offer.provider)).toEqual(["duffel", "travelpayouts"]);
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
