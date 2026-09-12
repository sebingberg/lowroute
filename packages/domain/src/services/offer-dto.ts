import type { NormalizedOffer } from "../entities/offer.js";
import { Money } from "../value-objects/money.js";

// ! pg-boss serializes job data as JSON, and JSON.stringify throws on bigint
// ! (Money.minorUnits). Offers crossing queue boundaries travel as OfferDto
// ! (minor units as decimal strings: lossless and JSON-safe) and are
// ! rehydrated to Money at the next job boundary. Domain Money stays intact
// ! everywhere else.
export type MoneyDto = {
  readonly currency: string;
  readonly minorUnits: string;
};

export type OfferDto = Omit<NormalizedOffer, "normalized_payable" | "quoted_price"> & {
  readonly normalized_payable: MoneyDto;
  readonly quoted_price: MoneyDto;
};

const toMoneyDto = (money: Money): MoneyDto => ({
  currency: money.currency,
  minorUnits: money.minorUnits.toString(),
});

const fromMoneyDto = (dto: MoneyDto): Money => new Money(BigInt(dto.minorUnits), dto.currency);

export const toOfferDto = (offer: NormalizedOffer): OfferDto => ({
  ...offer,
  normalized_payable: toMoneyDto(offer.normalized_payable),
  quoted_price: toMoneyDto(offer.quoted_price),
});

export const fromOfferDto = (dto: OfferDto): NormalizedOffer => ({
  ...dto,
  normalized_payable: fromMoneyDto(dto.normalized_payable),
  quoted_price: fromMoneyDto(dto.quoted_price),
});
