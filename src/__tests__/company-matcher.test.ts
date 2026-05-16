import { describe, it, expect } from 'vitest';
import { matchCompanyByCardNumber } from '../lib/insurance/company-matcher';

const mockCompanies = [
  { id: '1', name: 'مصرف الوحدة', code: 'WAB', card_pattern: '^WAB-\\d' },
  { id: '2', name: 'شركة المدار', code: 'MDAR', card_pattern: '^MDAR-' },
  { id: '3', name: 'بدون نمط', code: 'NOPAT', card_pattern: null },
];

describe('matchCompanyByCardNumber', () => {
  it('returns null for empty companies list', () => {
    expect(matchCompanyByCardNumber('WAB-123', [])).toBeNull();
  });

  it('returns null for null/undefined companies list', () => {
    expect(matchCompanyByCardNumber('WAB-123', null as any)).toBeNull();
  });

  it('matches company by regex card_pattern', () => {
    const result = matchCompanyByCardNumber('WAB-123', mockCompanies);
    expect(result).toEqual({ id: '1', name: 'مصرف الوحدة', code: 'WAB' });
  });

  it('matches company by regex with case insensitivity', () => {
    const result = matchCompanyByCardNumber('wab-123', mockCompanies);
    expect(result).toEqual({ id: '1', name: 'مصرف الوحدة', code: 'WAB' });
  });

  it('matches MDAR pattern correctly', () => {
    const result = matchCompanyByCardNumber('MDAR-999', mockCompanies);
    expect(result).toEqual({ id: '2', name: 'شركة المدار', code: 'MDAR' });
  });

  it('does not match companies with null card_pattern by prefix', () => {
    const result = matchCompanyByCardNumber('NOPAT-123', mockCompanies);
    expect(result).toBeNull();
  });

  it('returns null when no pattern matches', () => {
    const result = matchCompanyByCardNumber('XXXX-000', mockCompanies);
    expect(result).toBeNull();
  });

  it('falls back to prefix matching when regex fails', () => {
    const result = matchCompanyByCardNumber('WABXYZ', mockCompanies);
    expect(result).toEqual({ id: '1', name: 'مصرف الوحدة', code: 'WAB' });
  });

  it('handles invalid regex gracefully', () => {
    const badCompanies = [
      { id: 'bad', name: 'Bad Regex', code: 'BAD', card_pattern: '[invalid' },
      { id: 'good', name: 'Good', code: 'GOOD', card_pattern: '^GOOD-' },
    ];
    const result = matchCompanyByCardNumber('GOOD-123', badCompanies);
    expect(result).toEqual({ id: 'good', name: 'Good', code: 'GOOD' });
  });
});
