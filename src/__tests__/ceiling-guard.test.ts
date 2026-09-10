import { describe, it, expect } from 'vitest';
import { InsuranceEngine } from '../lib/insurance/engine';
import {
  isCeilingExceeded,
  assertWithinCeiling,
  isSessionLimitExceeded,
  assertWithinSessionLimit,
} from '../lib/insurance/ceiling-guard';
import { calculatePhysiotherapySessions } from '../lib/physiotherapy-sessions';

const calc = (amount: number, consumedThisYear: number, annualCeiling: number | null, copayPercentage = 0) =>
  InsuranceEngine.calculate({
    amount,
    consumedThisYear,
    policy: { serviceType: 'DENTAL', annualCeiling, copayPercentage, allowPartialCoverage: true },
  });

describe('ceiling guard', () => {
  it('allows a claim fully covered by the remaining ceiling', () => {
    expect(isCeilingExceeded(calc(100, 0, 1000))).toBe(false);
  });

  it('allows a claim that consumes the ceiling exactly', () => {
    expect(isCeilingExceeded(calc(100, 900, 1000))).toBe(false);
  });

  it('blocks a claim that partially exceeds the ceiling', () => {
    expect(isCeilingExceeded(calc(500, 900, 1000))).toBe(true);
  });

  // الحالة التي لا تلتقطها isPartialCoverage: السقف مستهلك بالكامل قبل الحركة.
  it('blocks a claim when the ceiling is already fully consumed', () => {
    const result = calc(100, 1000, 1000);
    expect(result.isPartialCoverage).toBe(false);
    expect(result.actualCompanyShare).toBe(0);
    expect(isCeilingExceeded(result)).toBe(true);
  });

  it('blocks a claim when consumption already overshot the ceiling', () => {
    expect(isCeilingExceeded(calc(50, 1500, 1000))).toBe(true);
  });

  it('never blocks an unlimited ceiling', () => {
    expect(isCeilingExceeded(calc(999_999, 5_000_000, null))).toBe(false);
  });

  it('never blocks a zero-coverage policy, since the company owes nothing', () => {
    const result = calc(500, 1000, 1000, 100);
    expect(result.originalCompanyShare).toBe(0);
    expect(isCeilingExceeded(result)).toBe(false);
  });

  it('applies copay before comparing against the ceiling', () => {
    // حصة الشركة 90 فقط، والمتبقي 100 => لا تجاوز رغم أن المبلغ الإجمالي 100 يساوي المتبقي
    expect(isCeilingExceeded(calc(100, 900, 1000, 10))).toBe(false);
    // حصة الشركة 180 والمتبقي 100 => تجاوز
    expect(isCeilingExceeded(calc(200, 900, 1000, 10))).toBe(true);
  });

  it('tolerates sub-piastre rounding noise', () => {
    const result = calc(100.005, 900, 1000);
    expect(isCeilingExceeded(result)).toBe(false);
  });

  it('throws an Arabic message naming the service and the remaining ceiling', () => {
    expect(() => assertWithinCeiling(calc(500, 900, 1000), 'DENTAL')).toThrow(/الأسنان/);
    expect(() => assertWithinCeiling(calc(500, 900, 1000), 'DENTAL')).toThrow(/تجاوز السقف السنوي/);
  });

  it('does not throw for an allowed claim', () => {
    expect(() => assertWithinCeiling(calc(100, 0, 1000), 'DENTAL')).not.toThrow();
  });
});

describe('physiotherapy session guard', () => {
  const sessions = (n: number, consumedBefore: number, limit: number | null) =>
    calculatePhysiotherapySessions({ sessions: n, consumedBefore, limit });

  it('allows sessions within the limit', () => {
    expect(isSessionLimitExceeded(sessions(5, 10, 20))).toBe(false);
  });

  it('allows sessions that hit the limit exactly', () => {
    expect(isSessionLimitExceeded(sessions(10, 10, 20))).toBe(false);
  });

  it('blocks sessions that exceed the limit', () => {
    expect(isSessionLimitExceeded(sessions(11, 10, 20))).toBe(true);
  });

  it('never blocks an unlimited session policy', () => {
    expect(isSessionLimitExceeded(sessions(500, 900, null))).toBe(false);
  });

  it('throws an Arabic message naming the session shortfall', () => {
    expect(() => assertWithinSessionLimit(sessions(11, 10, 20))).toThrow(/تجاوز السقف السنوي لجلسات/);
  });
});
