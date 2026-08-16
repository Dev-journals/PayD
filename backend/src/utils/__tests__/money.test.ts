import { Money } from '../money.js';

describe('Money', () => {
  describe('from', () => {
    it('should create from integer', () => {
      const m = Money.from(1000);
      expect(m.toNumber()).toBe(1000);
    });

    it('should create from decimal number', () => {
      const m = Money.from(123.456789);
      expect(m.toFixed(7)).toBe('123.4567890');
    });

    it('should create from string', () => {
      const m = Money.from('5000.1234567');
      expect(m.toFixed(7)).toBe('5000.1234567');
    });

    it('should create zero', () => {
      const m = Money.zero();
      expect(m.toNumber()).toBe(0);
    });
  });

  describe('add', () => {
    it('should add two amounts exactly', () => {
      const a = Money.from(100.1);
      const b = Money.from(200.2);
      expect(a.add(b).toFixed(7)).toBe('300.3000000');
    });

    it('should not drift on repeated addition', () => {
      let sum = Money.zero();
      const one = Money.from('0.1');
      for (let i = 0; i < 10; i++) {
        sum = sum.add(one);
      }
      expect(sum.toFixed(7)).toBe('1.0000000');
    });
  });

  describe('sub', () => {
    it('should subtract exactly', () => {
      const a = Money.from(5000);
      const b = Money.from(1234.567);
      expect(a.sub(b).toFixed(7)).toBe('3765.4330000');
    });
  });

  describe('mul', () => {
    it('should multiply correctly', () => {
      const a = Money.from(100);
      const b = Money.from(3);
      expect(a.mul(b).toNumber()).toBe(300);
    });
  });

  describe('percentage', () => {
    it('should calculate percentage correctly', () => {
      const gross = Money.from(5000);
      const tax = gross.percentage(20);
      expect(tax.toNumber()).toBe(1000);
    });

    it('should handle fractional percentages', () => {
      const gross = Money.from(10000);
      const tax = gross.percentage(7.65);
      expect(tax.toFixed(7)).toBe('765.0000000');
    });

    it('should calculate 22% of 10000', () => {
      const gross = Money.from(10000);
      expect(gross.percentage(22).toNumber()).toBe(2200);
    });
  });

  describe('max', () => {
    it('should return larger value', () => {
      const a = Money.from(100);
      const b = Money.from(200);
      expect(a.max(b).toNumber()).toBe(200);
    });

    it('should return this when equal', () => {
      const a = Money.from(100);
      const b = Money.from(100);
      expect(a.max(b).toNumber()).toBe(100);
    });
  });

  describe('isNegative / isZero', () => {
    it('should detect negative', () => {
      const m = Money.from(0).sub(Money.from(1));
      expect(m.isNegative()).toBe(true);
      expect(m.isZero()).toBe(false);
    });

    it('should detect zero', () => {
      const m = Money.from(0);
      expect(m.isZero()).toBe(true);
      expect(m.isNegative()).toBe(false);
    });
  });

  describe('toNumber', () => {
    it('should round to number representation', () => {
      const m = Money.from('123.4567890');
      expect(m.toNumber()).toBeCloseTo(123.456789, 6);
    });
  });

  describe('stacked deduction drift regression', () => {
    it('should not drift when summing 10 stacked percentage deductions', () => {
      const gross = Money.from(100000);
      const rules = [
        { name: 'Federal', rate: 22 },
        { name: 'State', rate: 5 },
        { name: 'SS', rate: 6.2 },
        { name: 'Medicare', rate: 1.45 },
        { name: 'SDI', rate: 1.2 },
        { name: 'FLI', rate: 0.9 },
        { name: 'Local', rate: 3.5 },
        { name: 'SUI', rate: 2.7 },
        { name: 'WC', rate: 0.8 },
        { name: 'Training', rate: 0.5 },
      ];

      let totalTax = Money.zero();
      for (const rule of rules) {
        const deduction = gross.percentage(rule.rate);
        totalTax = totalTax.add(deduction);
      }

      const net = gross.sub(totalTax);

      // Exact expected: 100000 * (22+5+6.2+1.45+1.2+0.9+3.5+2.7+0.8+0.5)/100
      // = 100000 * 44.25/100 = 44250
      expect(totalTax.toFixed(7)).toBe('44250.0000000');
      expect(net.toFixed(7)).toBe('55750.0000000');
      expect(totalTax.add(net).toFixed(7)).toBe(gross.toFixed(7));
    });

    it('should produce exact sum when old float code would drift', () => {
      // This test demonstrates that 0.1 + 0.2 ≠ 0.3 in floats
      // but Money handles it correctly
      const a = Money.from('0.1');
      const b = Money.from('0.2');
      const c = Money.from('0.3');
      expect(a.add(b).toFixed(7)).toBe(c.toFixed(7));
    });
  });
});
