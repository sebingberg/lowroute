import { describe, expect, it } from "vitest";

import { type ProviderOfferInput, toNormalizedOffer } from "./provider-offer-adapter.js";
import { buildTravelRulesService } from "./travel-rules-service.js";

const baseOffer: ProviderOfferInput = {
  provider: "duffel",
  origin: "EZE",
  destination: "MAD",
  departure_date: "2026-10-01",
  return_date: "2026-10-15",
  merchant_country: "US",
  currency: "usd",
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
};

const ctx = { maxLayoverHours: 8 };
// ! Built once per suite: production builds the rules service once per batch
// ! in fetchOffers, never per offer (see B3 note in provider-offer-adapter.ts).
const rules = buildTravelRulesService({ MAX_LAYOVER_HOURS: ctx.maxLayoverHours });

describe("toNormalizedOffer", () => {
  it("normalizes lowercase usd quotes and echoes search context", () => {
    const offer = toNormalizedOffer(baseOffer, ctx, rules);

    expect(offer).not.toBeNull();
    expect(offer?.quoted_price.currency).toBe("USD");
    expect(offer?.quoted_price.amount).toBe(500);
    expect(offer?.normalized_payable.currency).toBe("USD");
    expect(offer?.trip_days).toBe(14);
    expect(offer?.destination_tier).toBe("medium");
    expect(offer?.cabin).toBe("economy");
    expect(offer?.max_layover_hours).toBe(8);
    expect(offer?.score).toBe(0);
  });

  it("does not cap connection_minutes_min (shortest connection, probe-side duty)", () => {
    // ! connection_minutes_min is the MINIMUM layover (mappers stamp Math.min
    // ! for the short-connection scoring penalty), so the adapter cannot treat
    // ! it as a maximum. Cap enforcement lives in the probes (exceedsLayoverCap
    // ! on the full layover list); a long minimum passes the adapter untouched.
    const longMinimum = toNormalizedOffer(
      { ...baseOffer, risk: { ...baseOffer.risk, connection_minutes_min: 481 } },
      ctx,
      rules,
    );

    expect(longMinimum?.connection_minutes_min).toBe(481);
  });

  it("maps unknown XX merchant country to foreign_card without dropping", () => {
    const offer = toNormalizedOffer({ ...baseOffer, merchant_country: "xx" }, ctx, rules);

    expect(offer?.merchant_country).toBe("XX");
    expect(offer?.payment_path).toBe("foreign_card");
  });

  it("maps AR merchant to foreign_card with no invented exception class", () => {
    const offer = toNormalizedOffer({ ...baseOffer, merchant_country: "ar" }, ctx, rules);

    expect(offer?.merchant_country).toBe("AR");
    expect(offer?.payment_path).toBe("foreign_card");
    expect(offer?.ar_exception_class).toBeUndefined();
  });

  it("preserves self_transfer and separate_tickets flags", () => {
    const offer = toNormalizedOffer(
      {
        ...baseOffer,
        risk: { ...baseOffer.risk, self_transfer: true, separate_tickets: true },
      },
      ctx,
      rules,
    );

    expect(offer?.self_transfer).toBe(true);
    expect(offer?.separate_tickets).toBe(true);
  });

  it("keeps direct flights with zero connection minutes", () => {
    const offer = toNormalizedOffer(baseOffer, ctx, rules);

    expect(offer?.connection_minutes_min).toBe(0);
  });

  it("drops non-USD quotes instead of passing through unconverted", () => {
    const ars = toNormalizedOffer(
      { ...baseOffer, currency: "ARS", quoted_amount: 100_000 },
      ctx,
      rules,
    );
    const eur = toNormalizedOffer(
      { ...baseOffer, currency: "eur", quoted_amount: 450 },
      ctx,
      rules,
    );

    // ! Drop-not-convert until an FX source feeds normalizePayableUsd; a
    // ! passthrough payable would corrupt the USD-baseline comparison.
    expect(ars).toBeNull();
    expect(eur).toBeNull();
  });

  it("drops zero, negative, and non-finite quoted amounts", () => {
    const zero = toNormalizedOffer({ ...baseOffer, quoted_amount: 0 }, ctx, rules);
    const negative = toNormalizedOffer({ ...baseOffer, quoted_amount: -50 }, ctx, rules);
    const nan = toNormalizedOffer({ ...baseOffer, quoted_amount: Number.NaN }, ctx, rules);
    const infinite = toNormalizedOffer(
      { ...baseOffer, quoted_amount: Number.POSITIVE_INFINITY },
      ctx,
      rules,
    );

    expect(zero).toBeNull();
    expect(negative).toBeNull();
    expect(nan).toBeNull();
    expect(infinite).toBeNull();
  });

  it("drops reversed return-before-departure ranges explicitly", () => {
    const offer = toNormalizedOffer(
      { ...baseOffer, departure_date: "2026-10-15", return_date: "2026-10-01" },
      ctx,
      rules,
    );

    expect(offer).toBeNull();
  });

  it("drops malformed date strings", () => {
    const badDeparture = toNormalizedOffer(
      { ...baseOffer, departure_date: "not-a-date" },
      ctx,
      rules,
    );
    const badReturn = toNormalizedOffer({ ...baseOffer, return_date: "" }, ctx, rules);

    expect(badDeparture).toBeNull();
    expect(badReturn).toBeNull();
  });

  it("rejects impossible calendar dates that Date.parse would normalize", () => {
    // ! Date.parse("2026-02-30T00:00:00.000Z") yields 2026-03-02 instead of
    // ! NaN; the adapter round-trips the canonical form to fail closed.
    const badDeparture = toNormalizedOffer(
      { ...baseOffer, departure_date: "2026-02-30" },
      ctx,
      rules,
    );
    const badReturn = toNormalizedOffer({ ...baseOffer, return_date: "2026-02-30" }, ctx, rules);
    const badMonth = toNormalizedOffer({ ...baseOffer, departure_date: "2026-13-01" }, ctx, rules);

    expect(badDeparture).toBeNull();
    expect(badReturn).toBeNull();
    expect(badMonth).toBeNull();
  });

  it("keeps valid leap-day dates unaffected", () => {
    const leapDay = toNormalizedOffer(
      { ...baseOffer, departure_date: "2024-02-29", return_date: "2024-03-14" },
      ctx,
      rules,
    );

    expect(leapDay?.trip_days).toBe(14);
  });

  it("uppercases origin and destination IATA codes", () => {
    const offer = toNormalizedOffer(
      { ...baseOffer, origin: "eze", destination: "mad" },
      ctx,
      rules,
    );

    expect(offer?.origin).toBe("EZE");
    expect(offer?.destination).toBe("MAD");
  });

  it("drops offers below the tier minimum trip days", () => {
    const offer = toNormalizedOffer({ ...baseOffer, return_date: "2026-10-11" }, ctx, rules);

    expect(offer).toBeNull();
  });

  it("drops offers with unknown destinations", () => {
    const offer = toNormalizedOffer({ ...baseOffer, destination: "ZZZ" }, ctx, rules);

    expect(offer).toBeNull();
  });
});
