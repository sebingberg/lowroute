import { describe, expect, it } from "vitest";

import type { NormalizedOffer } from "../entities/offer.js";
import { Money } from "../value-objects/money.js";
import {
  buildAlertFingerprint,
  buildOfferFingerprint,
  DEFAULT_ALERT_TEMPLATE_VERSION,
} from "./alert-fingerprints.js";

const baseOffer: NormalizedOffer = {
  provider: "duffel",
  origin: "EZE",
  destination: "MIA",
  departure_date: "2026-10-10",
  return_date: "2026-11-01",
  trip_days: 22,
  destination_tier: "far",
  cabin: "economy",
  max_layover_hours: 4,
  self_transfer: false,
  separate_tickets: false,
  airport_change: false,
  overnight_layover: false,
  checked_bag_included: false,
  carry_on_included: true,
  connection_minutes_min: 100,
  merchant_country: "US",
  quoted_price: Money.fromDecimal(550, "USD"),
  normalized_payable: Money.fromDecimal(550, "USD"),
  payment_path: "foreign_card",
  score: 900,
};

describe("alert fingerprints", () => {
  it("returns stable offer fingerprints for identical offers", () => {
    const a = buildOfferFingerprint(baseOffer);
    const b = buildOfferFingerprint({ ...baseOffer });
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });

  it("changes offer fingerprint when normalized payable changes", () => {
    const a = buildOfferFingerprint(baseOffer);
    const b = buildOfferFingerprint({
      ...baseOffer,
      normalized_payable: Money.fromDecimal(551, "USD"),
    });
    expect(a).not.toBe(b);
  });

  it("composes alert fingerprint from offer fingerprint, chat, and template version", () => {
    const ofp = buildOfferFingerprint(baseOffer);
    const a = buildAlertFingerprint(ofp, "chat-a", DEFAULT_ALERT_TEMPLATE_VERSION);
    const b = buildAlertFingerprint(ofp, "chat-b", DEFAULT_ALERT_TEMPLATE_VERSION);
    const c = buildAlertFingerprint(ofp, "chat-a", "2");
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });
});
