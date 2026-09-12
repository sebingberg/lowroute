import { describe, expect, it } from "vitest";

import type { NormalizedOffer } from "../entities/offer.js";
import { Money } from "../value-objects/money.js";
import { fromOfferDto, toOfferDto } from "./offer-dto.js";

const offer: NormalizedOffer = {
  provider: "duffel",
  origin: "EZE",
  destination: "MAD",
  departure_date: "2026-10-01",
  return_date: "2026-10-15",
  trip_days: 14,
  destination_tier: "medium",
  cabin: "economy",
  max_layover_hours: 8,
  self_transfer: false,
  separate_tickets: false,
  airport_change: false,
  overnight_layover: false,
  checked_bag_included: false,
  carry_on_included: true,
  connection_minutes_min: 60,
  merchant_country: "US",
  quoted_price: Money.fromDecimal(500.5, "USD"),
  normalized_payable: Money.fromDecimal(500.5, "USD"),
  payment_path: "merchant_outside_ar",
  score: 0,
};

describe("offer DTO", () => {
  it("survives a JSON round-trip and rehydrates to equal Money", () => {
    const dto = toOfferDto(offer);

    // ! This is the pg-boss boundary: raw NormalizedOffer throws here on bigint.
    const serialized = JSON.stringify(dto);
    expect(() => JSON.parse(serialized)).not.toThrow();

    const rehydrated = fromOfferDto(JSON.parse(serialized) as ReturnType<typeof toOfferDto>);
    expect(rehydrated).toEqual(offer);
    expect(rehydrated.quoted_price).toBeInstanceOf(Money);
    expect(rehydrated.normalized_payable).toBeInstanceOf(Money);
    expect(rehydrated.quoted_price.minorUnits).toBe(offer.quoted_price.minorUnits);
    expect(rehydrated.normalized_payable.minorUnits).toBe(offer.normalized_payable.minorUnits);
  });

  it("proves the raw offer is not JSON-safe (bigint minorUnits)", () => {
    expect(() => JSON.stringify(offer)).toThrow(TypeError);
  });
});
