import { describe, expect, it } from "vitest";

import type { NormalizedOffer } from "../entities/offer.js";
import { Money } from "../value-objects/money.js";
import { buildTravelRulesService } from "./travel-rules-service.js";

const baseOffer: NormalizedOffer = {
  provider: "duffel",
  origin: "EZE",
  destination: "MAD",
  departure_date: "2026-09-01",
  return_date: "2026-09-15",
  trip_days: 14,
  destination_tier: "medium",
  cabin: "economy",
  max_layover_hours: 4,
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

describe("travel rules", () => {
  it("accepts offer meeting hard constraints", () => {
    const service = buildTravelRulesService({ MAX_LAYOVER_HOURS: 8 });
    expect(service.passesHardRules(baseOffer)).toBe(true);
  });

  it("rejects offer below tier minimum days", () => {
    const service = buildTravelRulesService({ MAX_LAYOVER_HOURS: 8 });
    expect(service.passesHardRules({ ...baseOffer, trip_days: 10 })).toBe(false);
  });

  it("uses configured layover cap", () => {
    const service = buildTravelRulesService({ MAX_LAYOVER_HOURS: 3 });
    expect(service.passesHardRules(baseOffer)).toBe(false);
  });
});
