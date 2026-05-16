import { describe, it, expect } from 'vitest';
import { InsuranceEngine } from '../lib/insurance/engine';

describe('InsuranceEngine', () => {
  describe('calculate', () => {
    it('should calculate shares with 0% copay', () => {
      const result = InsuranceEngine.calculate({
        amount: 100,
        consumedThisYear: 0,
        policy: { serviceType: 'GENERAL', annualCeiling: 1000, copayPercentage: 0, allowPartialCoverage: true },
      });
      expect(result.originalPatientShare).toBe(0);
      expect(result.originalCompanyShare).toBe(100);
      expect(result.actualPatientShare).toBe(0);
      expect(result.actualCompanyShare).toBe(100);
      expect(result.isPartialCoverage).toBe(false);
    });

    it('should calculate shares with 25% copay', () => {
      const result = InsuranceEngine.calculate({
        amount: 200,
        consumedThisYear: 0,
        policy: { serviceType: 'GENERAL', annualCeiling: 1000, copayPercentage: 25, allowPartialCoverage: true },
      });
      expect(result.originalPatientShare).toBe(50);
      expect(result.originalCompanyShare).toBe(150);
    });

    it('should cap company share at remaining ceiling', () => {
      const result = InsuranceEngine.calculate({
        amount: 500,
        consumedThisYear: 900,
        policy: { serviceType: 'DENTAL', annualCeiling: 1000, copayPercentage: 10, allowPartialCoverage: true },
      });
      expect(result.remainingCeilingBefore).toBe(100);
      expect(result.actualCompanyShare).toBe(100);
      expect(result.isPartialCoverage).toBe(true);
      expect(result.actualPatientShare).toBe(400);
    });

    it('should handle unlimited ceiling (null)', () => {
      const result = InsuranceEngine.calculate({
        amount: 5000,
        consumedThisYear: 10000,
        policy: { serviceType: 'GENERAL', annualCeiling: null, copayPercentage: 20, allowPartialCoverage: true },
      });
      expect(result.actualCompanyShare).toBe(4000);
      expect(result.actualPatientShare).toBe(1000);
      expect(result.isPartialCoverage).toBe(false);
    });

    it('should return zero company share when ceiling is exhausted', () => {
      const result = InsuranceEngine.calculate({
        amount: 100,
        consumedThisYear: 1000,
        policy: { serviceType: 'GENERAL', annualCeiling: 1000, copayPercentage: 10, allowPartialCoverage: true },
      });
      expect(result.remainingCeilingBefore).toBe(0);
      expect(result.actualCompanyShare).toBe(0);
      expect(result.actualPatientShare).toBe(100);
      expect(result.isPartialCoverage).toBe(false);
    });

    it('should handle partial coverage disabled (full patient pays when ceiling exceeded)', () => {
      const result = InsuranceEngine.calculate({
        amount: 300,
        consumedThisYear: 850,
        policy: { serviceType: 'OPTICS', annualCeiling: 1000, copayPercentage: 30, allowPartialCoverage: false },
      });
      expect(result.originalCompanyShare).toBe(210);
      expect(result.remainingCeilingBefore).toBe(150);
      expect(result.actualCompanyShare).toBe(150);
      expect(result.isPartialCoverage).toBe(true);
    });

    it('should track ceiling consumption correctly', () => {
      const result = InsuranceEngine.calculate({
        amount: 200,
        consumedThisYear: 400,
        policy: { serviceType: 'GENERAL', annualCeiling: 500, copayPercentage: 10, allowPartialCoverage: true },
      });
      expect(result.remainingCeilingBefore).toBe(100);
      expect(result.ceilingConsumed).toBe(100);
      expect(result.remainingCeilingAfter).toBe(0);
      expect(result.actualCompanyShare).toBe(100);
      expect(result.actualPatientShare).toBe(100);
    });

    it('should return metadata with engine version', () => {
      const result = InsuranceEngine.calculate({
        amount: 100,
        consumedThisYear: 0,
        policy: { serviceType: 'GENERAL', annualCeiling: 1000, copayPercentage: 10, allowPartialCoverage: true },
      });
      expect(result.metadata.engineVersion).toBe('1.0.0');
      expect(result.metadata.timestamp).toBeDefined();
    });
  });

  describe('getFiscalYear', () => {
    it('should return the year from a date', () => {
      expect(InsuranceEngine.getFiscalYear(new Date('2026-05-16'))).toBe(2026);
    });
  });
});
