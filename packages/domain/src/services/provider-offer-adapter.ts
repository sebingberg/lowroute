import { destinations } from "../destinations.js";
import type { NormalizedOffer } from "../entities/offer.js";
import { Money } from "../value-objects/money.js";
import type { TravelRulesService } from "./travel-rules-service.js";

// ! Minimal structural copy of providers NormalizedProviderOffer minus
// ! provider-owned fields (id, raw_ref). Domain must not import
// ! @lowroute/providers, not even `import type`: providers depends on domain
// ! (see packages/providers/package.json), so that edge would cycle the
// ! package graph. Sync is enforced by the compile-time subset assertion in
// ! apps/service/src/jobs/fetch-offers.test.ts; update this shape alongside
// ! packages/providers/src/types.ts.
export type ProviderOfferInput = {
  readonly provider: string;
  readonly origin: string;
  readonly destination: string;
  readonly departure_date: string;
  readonly return_date: string;
  readonly merchant_country: string;
  readonly currency: string;
  readonly quoted_amount: number;
  readonly risk: {
    readonly self_transfer: boolean;
    readonly separate_tickets: boolean;
    readonly airport_change: boolean;
    readonly overnight_layover: boolean;
    readonly checked_bag_included: boolean;
    readonly carry_on_included: boolean;
    readonly connection_minutes_min: number;
  };
};

export type ProviderOfferAdapterContext = {
  readonly maxLayoverHours: number;
};

const DAY_MS = 86_400_000;

const tripDaysBetween = (departureDate: string, returnDate: string): number | null => {
  const start = Date.parse(`${departureDate}T00:00:00.000Z`);
  const end = Date.parse(`${returnDate}T00:00:00.000Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return null;
  }
  return Math.round((end - start) / DAY_MS);
};

export const toNormalizedOffer = (
  offer: ProviderOfferInput,
  ctx: ProviderOfferAdapterContext,
  rules: TravelRulesService,
): NormalizedOffer | null => {
  // ! Single connection-cap enforcement point: this per-offer pre-check.
  // ! passesHardRules below re-checks the stamped max_layover_hours against a
  // ! rules service built from the same search value (once per batch in
  // ! fetchOffers), so it holds by construction; the global env
  // ! MAX_LAYOVER_HOURS is intentionally not consulted on this path.
  if (offer.risk.connection_minutes_min > ctx.maxLayoverHours * 60) {
    return null;
  }

  const destination = offer.destination.toUpperCase();
  const tier = destinations.find((destinationEntry) => destinationEntry.code === destination)?.tier;
  if (tier === undefined) {
    return null;
  }

  const tripDays = tripDaysBetween(offer.departure_date, offer.return_date);
  // ! Explicit invalid-range guard: malformed strings and reversed
  // ! return-before-departure ranges fail closed here, not silently via the
  // ! tier minimum-days hard rule.
  if (tripDays === null || tripDays < 0) {
    return null;
  }

  // ! Drop-not-convert: normalized_payable feeds the USD-baseline comparison,
  // ! so a non-USD quote with no FX rate would corrupt ranking. Non-USD offers
  // ! return null until an FX source feeds cost-normalization-service
  // ! normalizePayableUsd (primary BNA, fallback openexchangerates per
  // ! docs/07-ar-cost-normalization.md FX Policy).
  if (offer.currency.toUpperCase() !== "USD") {
    return null;
  }

  const merchantCountry = offer.merchant_country.toUpperCase();
  const quotedPrice = Money.fromDecimal(offer.quoted_amount, offer.currency);
  const candidate: NormalizedOffer = {
    provider: offer.provider,
    origin: offer.origin.toUpperCase(),
    destination,
    departure_date: offer.departure_date,
    return_date: offer.return_date,
    trip_days: tripDays,
    destination_tier: tier,
    cabin: "economy",
    max_layover_hours: ctx.maxLayoverHours,
    ...offer.risk,
    merchant_country: merchantCountry,
    quoted_price: quotedPrice,
    normalized_payable: quotedPrice,
    // ! AR merchants map to foreign_card: not merchant_outside_ar (would
    // ! misstate the merchant location per
    // ! .cursor/rules/domain-deal-rules.mdc pitfalls), and not ar_card (needs a
    // ! documented exception class plus AR-card payment per AGENTS.md Domain
    // ! Rules and docs/07-ar-cost-normalization.md R3). Probe offers carry no
    // ! card/tax-class context, so foreign_card (DEFAULT_PAYMENT_PATH) is the
    // ! honest no-tax default: cost-normalization-service applies AR tax only
    // ! for ar_card + AR merchant + ar_exception_class.
    payment_path: merchantCountry === "AR" ? "foreign_card" : "merchant_outside_ar",
    score: 0,
  };

  return rules.passesHardRules(candidate) ? candidate : null;
};
