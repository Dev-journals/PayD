/**
 * Fixed-point money type that avoids JS floating-point drift.
 * Internally stores amounts as BigInt scaled to 7 decimal places
 * (matching Stellar stroop-level precision).
 */
const DECIMALS = 7;
const SCALE = 10n ** BigInt(DECIMALS);

export class Money {
  private readonly cents: bigint;

  private constructor(cents: bigint) {
    this.cents = cents;
  }

  static from(value: number | string): Money {
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new Error(`Invalid money value: ${value}`);
      return new Money(BigInt(Math.round(value * Number(SCALE))));
    }
    const s = value.trim();
    if (!s) throw new Error('Empty money string');
    const [intPart, fracPart = ''] = s.split('.');
    const padded = fracPart.padEnd(DECIMALS, '0').slice(0, DECIMALS);
    return new Money(BigInt(intPart!) * SCALE + BigInt(padded));
  }

  static zero(): Money {
    return new Money(0n);
  }

  add(other: Money): Money {
    return new Money(this.cents + other.cents);
  }

  sub(other: Money): Money {
    return new Money(this.cents - other.cents);
  }

  mul(other: Money): Money {
    return new Money((this.cents * other.cents) / SCALE);
  }

  div(other: Money): Money {
    if (other.cents === 0n) throw new Error('Division by zero');
    return new Money((this.cents * SCALE) / other.cents);
  }

  percentage(rate: number): Money {
    return new Money((this.cents * BigInt(Math.round(rate * 1e7))) / 10_000_000n / 100n);
  }

  isNegative(): boolean {
    return this.cents < 0n;
  }

  isZero(): boolean {
    return this.cents === 0n;
  }

  max(other: Money): Money {
    return this.cents >= other.cents ? this : other;
  }

  toNumber(): number {
    return parseFloat(this.toFixed(DECIMALS));
  }

  toFixed(decimals: number = DECIMALS): string {
    const sign = this.cents < 0n ? '-' : '';
    const abs = this.cents < 0n ? -this.cents : this.cents;
    const intPart = abs / SCALE;
    const fracPart = abs % SCALE;
    return `${sign}${intPart}.${fracPart.toString().padStart(DECIMALS, '0').slice(0, decimals)}`;
  }
}
