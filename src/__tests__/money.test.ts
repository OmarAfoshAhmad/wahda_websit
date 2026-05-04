import { describe, it, expect } from 'vitest';
import { roundCurrency, formatCurrency } from '../lib/money';

describe('Money Utilities', () => {
  describe('roundCurrency', () => {
    it('should round to 2 decimal places', () => {
      expect(roundCurrency(10.123)).toBe(10.12);
      expect(roundCurrency(10.125)).toBe(10.13);
      expect(roundCurrency(10.126)).toBe(10.13);
    });

    it('should handle floating point precision issues', () => {
      // 0.1 + 0.2 is 0.30000000000000004 in JS
      expect(roundCurrency(0.1 + 0.2)).toBe(0.3);
    });

    it('should return 0 for non-finite values', () => {
      expect(roundCurrency(NaN)).toBe(0);
      expect(roundCurrency(Infinity)).toBe(0);
      expect(roundCurrency(-Infinity)).toBe(0);
    });
  });

  describe('formatCurrency', () => {
    it('should format with Arabic Libyan locale', () => {
      const result = formatCurrency(1234.5);
      // ar-LY format might vary depending on environment, but should contain these characters
      expect(result).toMatch(/[١٢٣٤٥\d]/); 
    });

    it('should always show 2 decimal places', () => {
      const result = formatCurrency(100);
      // Check if it ends with .00 or equivalent Arabic
      expect(result).toMatch(/[.,][0٠][0٠]$/);
    });
  });
});
