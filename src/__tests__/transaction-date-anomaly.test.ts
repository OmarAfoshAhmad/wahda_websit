import { describe, it, expect } from 'vitest';
import { suggestSwappedDate, validateCorrectedDate } from '../lib/transaction-date-anomaly';

const TODAY = '2026-09-10';
const utc = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe('suggestSwappedDate', () => {
  it('swaps day and month for a future date whose day fits as a month', () => {
    expect(suggestSwappedDate(utc('2026-10-05'), TODAY)).toBe('2026-05-10');
    expect(suggestSwappedDate(utc('2026-12-04'), TODAY)).toBe('2026-04-12');
    expect(suggestSwappedDate(utc('2026-11-01'), TODAY)).toBe('2026-01-11');
  });

  it('gives no suggestion when the day cannot be a month', () => {
    expect(suggestSwappedDate(utc('2026-10-25'), TODAY)).toBeNull();
  });

  it('gives no suggestion when the swap is still in the future', () => {
    expect(suggestSwappedDate(utc('2027-01-05'), TODAY)).toBeNull();
    expect(suggestSwappedDate(utc('2028-05-04'), TODAY)).toBeNull();
  });

  it('gives no suggestion when the swap is still too old', () => {
    expect(suggestSwappedDate(utc('2006-05-04'), TODAY)).toBeNull();
  });

  it('gives no suggestion when day equals month, since swapping changes nothing', () => {
    expect(suggestSwappedDate(utc('2026-11-11'), TODAY)).toBeNull();
  });

  it('reads the calendar day in Tripoli time, not UTC', () => {
    // 23:30 UTC on Oct 4 is already Oct 5 in Tripoli (UTC+2).
    expect(suggestSwappedDate(new Date('2026-10-04T23:30:00.000Z'), TODAY)).toBe('2026-05-10');
  });
});

describe('validateCorrectedDate', () => {
  it('accepts a well-formed in-range date and pins it to noon UTC', () => {
    const res = validateCorrectedDate('2026-05-10', TODAY);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.date.toISOString()).toBe('2026-05-10T12:00:00.000Z');
  });

  it('rejects malformed input', () => {
    expect(validateCorrectedDate('10/05/2026', TODAY).ok).toBe(false);
    expect(validateCorrectedDate('', TODAY).ok).toBe(false);
  });

  it('rejects dates before the floor', () => {
    expect(validateCorrectedDate('2019-12-31', TODAY).ok).toBe(false);
  });

  it('rejects future dates', () => {
    expect(validateCorrectedDate('2026-09-11', TODAY).ok).toBe(false);
  });

  it('accepts today', () => {
    expect(validateCorrectedDate(TODAY, TODAY).ok).toBe(true);
  });
});
