import { describe, it, expect } from 'vitest';
import { getFiscalYear, getFiscalYearBounds } from '../lib/insurance/fiscal-year';

describe('getFiscalYear (Africa/Tripoli, UTC+2)', () => {
  it('uses the Tripoli calendar year, not the server one', () => {
    // 23:30 UTC on Dec 31 is already Jan 1 01:30 in Tripoli.
    expect(getFiscalYear(new Date('2026-12-31T23:30:00.000Z'))).toBe(2027);
    // 21:30 UTC on Dec 31 is still Dec 31 23:30 in Tripoli.
    expect(getFiscalYear(new Date('2026-12-31T21:30:00.000Z'))).toBe(2026);
  });

  it('is stable for ordinary mid-year dates', () => {
    expect(getFiscalYear(new Date('2026-06-15T12:00:00.000Z'))).toBe(2026);
  });
});

describe('getFiscalYearBounds', () => {
  it('spans Jan 1 00:00 to Dec 31 23:59:59.999 in Tripoli time', () => {
    const { start, end } = getFiscalYearBounds(2026);
    expect(start.toISOString()).toBe('2025-12-31T22:00:00.000Z');
    expect(end.toISOString()).toBe('2026-12-31T21:59:59.999Z');
  });

  it('agrees with getFiscalYear at both edges', () => {
    const { start, end } = getFiscalYearBounds(2026);
    expect(getFiscalYear(start)).toBe(2026);
    expect(getFiscalYear(end)).toBe(2026);
    expect(getFiscalYear(new Date(start.getTime() - 1))).toBe(2025);
    expect(getFiscalYear(new Date(end.getTime() + 1))).toBe(2027);
  });
});
