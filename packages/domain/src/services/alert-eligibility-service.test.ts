import { describe, expect, it, vi } from "vitest";

import type { NormalizedOffer } from "../entities/offer.js";
import { Money } from "../value-objects/money.js";
import { buildAlertEligibilityService } from "./alert-eligibility-service.js";
import {
  buildAlertFingerprint,
  buildOfferFingerprint,
  DEFAULT_ALERT_TEMPLATE_VERSION,
} from "./alert-fingerprints.js";
import type { BaselineStats } from "./deal-baseline-service.js";

const offer: NormalizedOffer = {
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

const baseline: BaselineStats = {
  route_key: "EZE-MIA",
  p20: Money.fromDecimal(600, "USD"),
  median: Money.fromDecimal(800, "USD"),
  sample_size: 24,
};

describe("alert eligibility", () => {
  it("uses route baseline threshold for selection", () => {
    const service = buildAlertEligibilityService({
      DEAL_PERCENTILE_THRESHOLD: 0.2,
      DEAL_DISCOUNT_PCT: undefined,
    });

    expect(service.shouldAlert(offer, baseline)).toBe(true);
    expect(
      service.shouldAlert(
        { ...offer, normalized_payable: Money.fromDecimal(650, "USD") },
        baseline,
      ),
    ).toBe(false);
  });

  it("does not alert without a baseline", () => {
    const service = buildAlertEligibilityService({
      DEAL_PERCENTILE_THRESHOLD: 0.2,
      DEAL_DISCOUNT_PCT: undefined,
    });

    expect(service.shouldAlert(offer, null)).toBe(false);
  });

  it("suppresses delivery when fingerprint was sent within cooldown", async () => {
    const service = buildAlertEligibilityService({
      DEAL_PERCENTILE_THRESHOLD: 0.2,
      DEAL_DISCOUNT_PCT: undefined,
    });

    const suppressed = await service.shouldAlertForDelivery(offer, baseline, {
      telegramChatId: "-100",
      alertCooldownHours: 6,
      wasSentRecently: async () => true,
    });

    expect(suppressed).toBe(false);
  });

  it("allows delivery when baseline passes and fingerprint is outside cooldown", async () => {
    const service = buildAlertEligibilityService({
      DEAL_PERCENTILE_THRESHOLD: 0.2,
      DEAL_DISCOUNT_PCT: undefined,
    });
    const wasSentRecently = vi.fn().mockResolvedValue(false);

    const allowed = await service.shouldAlertForDelivery(offer, baseline, {
      telegramChatId: "-100",
      alertCooldownHours: 6,
      wasSentRecently,
    });

    const expectedAlertFingerprint = buildAlertFingerprint(
      buildOfferFingerprint(offer),
      "-100",
      DEFAULT_ALERT_TEMPLATE_VERSION,
    );

    expect(allowed).toBe(true);
    expect(wasSentRecently).toHaveBeenCalledWith(expectedAlertFingerprint, 6);
  });

  it("does not deliver without a baseline", async () => {
    const service = buildAlertEligibilityService({
      DEAL_PERCENTILE_THRESHOLD: 0.2,
      DEAL_DISCOUNT_PCT: undefined,
    });

    const out = await service.shouldAlertForDelivery(offer, null, {
      telegramChatId: "-100",
      alertCooldownHours: 6,
      wasSentRecently: async () => false,
    });

    expect(out).toBe(false);
  });
});
