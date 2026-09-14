import { describe, it, expect } from 'vitest';
import { deductionSchema, MAX_DEDUCTION_AMOUNT } from '../lib/validation';

const parse = (amount: number, type: string) => deductionSchema.safeParse({ card_number: 'JFZ1', amount, type });

describe('deductionSchema amount rules per wallet', () => {
  it('caps base-balance deductions at MAX_DEDUCTION_AMOUNT and enforces the fraction policy', () => {
    expect(parse(MAX_DEDUCTION_AMOUNT + 1, 'MEDICINE').success).toBe(false);
    expect(parse(100.1, 'GENERAL').success).toBe(false);
    expect(parse(100.25, 'GENERAL').success).toBe(true);
  });

  it('does not cap dental or optics invoices, since the annual ceiling governs them', () => {
    expect(parse(5500, 'DENTAL').success).toBe(true);
    expect(parse(25000, 'OPTICS').success).toBe(true);
    expect(parse(412.5, 'DENTAL').success).toBe(true);
    expect(parse(412.37, 'DENTAL').success).toBe(true);
  });

  it('limits dental and optics invoices to two decimals', () => {
    expect(parse(412.375, 'DENTAL').success).toBe(false);
  });

  it('requires a positive whole number of physiotherapy sessions', () => {
    expect(parse(12, 'PHYSIOTHERAPY').success).toBe(true);
    expect(parse(12.5, 'PHYSIOTHERAPY').success).toBe(false);
    expect(parse(0, 'PHYSIOTHERAPY').success).toBe(false);
  });
});
