import { describe, it, expect } from 'vitest';
import { resolveWalletPolicy, type CompanyForPolicy } from '../lib/insurance/policy';
import { WAHDA_BANK_COMPANY_ID } from '../lib/constants';

const company = (over: Partial<CompanyForPolicy> = {}): CompanyForPolicy => ({
  id: 'c1',
  code: 'JMR',
  general_ceiling: 5000,
  general_coverage: 90,
  medicine_ceiling: 3000,
  medicine_coverage: 70,
  dental_settings: null,
  service_policies: [
    { service_type: { code: 'DENTAL' }, ceiling_amount: 1000, coverage_percent: 80 },
    { service_type: { code: 'OPTICS' }, ceiling_amount: 400, coverage_percent: 100 },
    { service_type: { code: 'PHYSIOTHERAPY' }, ceiling_amount: 20, coverage_percent: 100 },
  ],
  ...over,
});

describe('resolveWalletPolicy', () => {
  it('reads dental ceiling and copay from the service policy', () => {
    expect(resolveWalletPolicy({ company: company(), customCeilings: null, walletType: 'DENTAL' })).toEqual({
      service_type: 'DENTAL', annual_ceiling: 1000, copay_percentage: 20, allow_partial_coverage: true,
    });
  });

  it('prefers a per-beneficiary custom ceiling, including an explicit unlimited null', () => {
    expect(resolveWalletPolicy({ company: company(), customCeilings: { DENTAL: 250 }, walletType: 'DENTAL' })?.annual_ceiling).toBe(250);
    expect(resolveWalletPolicy({ company: company(), customCeilings: { DENTAL: null }, walletType: 'DENTAL' })?.annual_ceiling).toBeNull();
    expect(resolveWalletPolicy({ company: company(), customCeilings: { OPTICS: 0 }, walletType: 'DENTAL' })?.annual_ceiling).toBe(1000);
  });

  it('applies dental sub-category coverage only when enabled in company settings', () => {
    const c = company({ dental_settings: { ortho: { enabled: true, coverage: 50 }, implant: { enabled: false, coverage: 10 } } });
    expect(resolveWalletPolicy({ company: c, customCeilings: null, walletType: 'DENTAL', dentalSubCategory: 'DENTAL_ORTHO' })?.copay_percentage).toBe(50);
    expect(resolveWalletPolicy({ company: c, customCeilings: null, walletType: 'DENTAL', dentalSubCategory: 'DENTAL_IMPLANT' })?.copay_percentage).toBe(20);
  });

  it('gives physiotherapy a session ceiling and no copay', () => {
    expect(resolveWalletPolicy({ company: company(), customCeilings: null, walletType: 'PHYSIOTHERAPY' })).toEqual({
      service_type: 'PHYSIOTHERAPY', annual_ceiling: 20, copay_percentage: 0, allow_partial_coverage: true,
    });
  });

  it('returns null for an isolated service the company has no policy for', () => {
    expect(resolveWalletPolicy({ company: company({ service_policies: [] }), customCeilings: null, walletType: 'OPTICS' })).toBeNull();
  });

  it('treats a ceiling of 0 as zero, not unlimited', () => {
    const c = company({ service_policies: [{ service_type: { code: 'OPTICS' }, ceiling_amount: 0, coverage_percent: 100 }] });
    expect(resolveWalletPolicy({ company: c, customCeilings: null, walletType: 'OPTICS' })?.annual_ceiling).toBe(0);
  });

  it('uses company-level general/medicine ceilings for TPA companies', () => {
    expect(resolveWalletPolicy({ company: company(), customCeilings: null, walletType: 'GENERAL' })).toMatchObject({ annual_ceiling: 5000, copay_percentage: 10 });
    expect(resolveWalletPolicy({ company: company(), customCeilings: null, walletType: 'MEDICINE' })).toMatchObject({ annual_ceiling: 3000, copay_percentage: 30 });
  });

  it('returns null for base-balance companies on general/medicine wallets', () => {
    expect(resolveWalletPolicy({ company: company({ code: 'WAB' }), customCeilings: null, walletType: 'MEDICINE' })).toBeNull();
    expect(resolveWalletPolicy({ company: company({ id: WAHDA_BANK_COMPANY_ID }), customCeilings: null, walletType: 'GENERAL' })).toBeNull();
    // لكن خدماتهم المعزولة تبقى بسياساتها.
    expect(resolveWalletPolicy({ company: company({ code: 'WAB' }), customCeilings: null, walletType: 'DENTAL' })).not.toBeNull();
  });
});
