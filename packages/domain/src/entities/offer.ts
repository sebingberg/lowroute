import type { Money } from "../value-objects/money.js";

export type DestinationTier = "near" | "medium" | "far";

export type PaymentPath = "foreign_card" | "ar_card" | "merchant_outside_ar";

export type ArMerchantExceptionClass =
  | "argentine_lcc_ars"
  | "aerolineas_ars_promo"
  | "despegar_almundo_ars_locked";

export type NormalizedOffer = {
  readonly provider: string;
  readonly origin: string;
  readonly destination: string;
  readonly departure_date: string;
  readonly return_date: string;
  readonly trip_days: number;
  readonly destination_tier: DestinationTier;
  readonly cabin: "economy";
  readonly max_layover_hours: number;
  readonly self_transfer: boolean;
  readonly separate_tickets: boolean;
  readonly airport_change: boolean;
  readonly overnight_layover: boolean;
  readonly checked_bag_included: boolean;
  readonly carry_on_included: boolean;
  readonly connection_minutes_min: number;
  readonly merchant_country: string;
  readonly quoted_price: Money;
  readonly normalized_payable: Money;
  readonly payment_path: PaymentPath;
  readonly ar_exception_class?: ArMerchantExceptionClass;
  readonly score: number;
};
