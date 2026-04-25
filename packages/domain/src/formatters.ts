import type { Money } from "./value-objects/money.js";
import { currencyExponent } from "./value-objects/money.js";

export const formatMoney = (money: Money, locale = "en-US"): string => {
  const fractionDigits = currencyExponent(money.currency);
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: money.currency,
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(money.amount);
};

export const formatUtcToTimezone = (
  isoDateTimeUtc: string,
  timezone = "America/Argentina/Buenos_Aires",
  locale = "en-AR",
): string => {
  return new Intl.DateTimeFormat(locale, {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(isoDateTimeUtc));
};
