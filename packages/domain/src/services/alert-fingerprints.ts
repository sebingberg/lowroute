import { createHash } from "node:crypto";

import type { NormalizedOffer } from "../entities/offer.js";

/** Bump when Telegram payload shape materially changes (see docs/03-alert-policy.md). */
export const DEFAULT_ALERT_TEMPLATE_VERSION = "1";

const OFFER_FINGERPRINT_PREFIX = "ofp:v1";
const ALERT_FINGERPRINT_PREFIX = "afp:v1";

/**
 * Stable id for offer rows and `sent_alerts.offer_fingerprint` FK.
 * Align material with `packages/persistence` offer `risk_flags` shape.
 */
export const buildOfferFingerprint = (offer: NormalizedOffer): string => {
  const material = [
    OFFER_FINGERPRINT_PREFIX,
    offer.provider,
    offer.origin,
    offer.destination,
    offer.departure_date,
    offer.return_date,
    offer.normalized_payable.currency,
    offer.normalized_payable.minorUnits.toString(),
    offer.payment_path,
    offer.ar_exception_class ?? "",
    offer.self_transfer ? "1" : "0",
    offer.separate_tickets ? "1" : "0",
    offer.airport_change ? "1" : "0",
    offer.overnight_layover ? "1" : "0",
    offer.checked_bag_included ? "1" : "0",
    offer.carry_on_included ? "1" : "0",
    String(offer.connection_minutes_min),
  ].join("|");

  return createHash("sha256").update(material, "utf8").digest("hex");
};

export const buildAlertFingerprint = (
  offerFingerprint: string,
  telegramChatId: string,
  templateVersion: string = DEFAULT_ALERT_TEMPLATE_VERSION,
): string => {
  const material = [
    ALERT_FINGERPRINT_PREFIX,
    offerFingerprint,
    telegramChatId,
    templateVersion,
  ].join("|");
  return createHash("sha256").update(material, "utf8").digest("hex");
};
