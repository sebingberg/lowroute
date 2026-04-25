import { describe, expect, it } from "vitest";

import type { NormalizedOffer } from "../entities/offer.js";
import { Money } from "../value-objects/money.js";
import { buildScoringService } from "./scoring-service.js";

const baseOffer: NormalizedOffer = {
  provider: "duffel",
  origin: "EZE",
  destination: "MAD",
  departure_date: "2026-09-01",
  return_date: "2026-09-15",
  trip_days: 14,
  destination_tier: "medium",
  cabin: "economy",
  max_layover_hours: 3,
  self_transfer: false,
  separate_tickets: false,
  airport_change: false,
  overnight_layover: false,
  checked_bag_included: false,
  carry_on_included: true,
  connection_minutes_min: 120,
  merchant_country: "US",
  quoted_price: Money.fromDecimal(700, "USD"),
  normalized_payable: Money.fromDecimal(700, "USD"),
  payment_path: "foreign_card",
  score: 0,
};

describe("scoring service", () => {
  it("penalizes itinerary risk fields", () => {
    const scoring = buildScoringService();

    const safeScore = scoring.score(baseOffer);
    const riskyScore = scoring.score({
      ...baseOffer,
      self_transfer: true,
      separate_tickets: true,
      airport_change: true,
      overnight_layover: true,
      connection_minutes_min: 75,
    });

    expect(riskyScore).toBeLessThan(safeScore);
  });

  it("ranks by computed score descending", () => {
    const scoring = buildScoringService();
    const ranked = scoring.rank([
      { ...baseOffer, normalized_payable: Money.fromDecimal(900, "USD") },
      { ...baseOffer, normalized_payable: Money.fromDecimal(600, "USD") },
    ]);

    expect(ranked[0]?.normalized_payable.amount).toBe(600);
  });
});
