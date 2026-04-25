export class Money {
  public readonly minorUnits: bigint;
  public readonly currency: string;

  public constructor(minorUnits: bigint, currency: string) {
    if (!currency || currency.length !== 3) {
      throw new Error("Money currency must be 3-letter ISO code");
    }

    this.minorUnits = minorUnits;
    this.currency = currency.toUpperCase();
  }

  public static fromDecimal(amount: number, currency: string): Money {
    if (!Number.isFinite(amount)) {
      throw new Error("Money amount must be finite");
    }

    const exponent = currencyExponent(currency);
    const scale = 10 ** exponent;
    return new Money(BigInt(Math.round(amount * scale)), currency);
  }

  public get amount(): number {
    return Number(this.minorUnits) / 10 ** currencyExponent(this.currency);
  }

  public add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.minorUnits + other.minorUnits, this.currency);
  }

  public subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.minorUnits - other.minorUnits, this.currency);
  }

  public multiply(factor: number): Money {
    if (!Number.isFinite(factor)) {
      throw new Error("Money multiplier must be finite");
    }

    return Money.fromDecimal(this.amount * factor, this.currency);
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new Error(`Currency mismatch: ${this.currency} != ${other.currency}`);
    }
  }
}

const CURRENCY_EXPONENTS: Record<string, number> = {
  BHD: 3,
  JPY: 0,
  KWD: 3,
  USD: 2,
};

export const currencyExponent = (currency: string): number => {
  return CURRENCY_EXPONENTS[currency.toUpperCase()] ?? 2;
};
