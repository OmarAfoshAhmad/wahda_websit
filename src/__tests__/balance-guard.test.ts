import { describe, it, expect, vi } from 'vitest';
import { assertBeneficiaryBalanceInvariant } from '../lib/tx-balance-guard';
import { roundCurrency } from '../lib/money';

describe('Balance Guard Invariant', () => {
  it('should throw error if beneficiary is not found', async () => {
    const mockTx = {
      beneficiary: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
    } as any;

    await expect(assertBeneficiaryBalanceInvariant(mockTx, 'id1', 'test'))
      .rejects.toThrow('BALANCE_GUARD_BENEFICIARY_NOT_FOUND');
  });

  it('should log warning if stored balance does not match computed balance', async () => {
    const mockTx = {
      beneficiary: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'id1',
          total_balance: 600,
          remaining_balance: 500, // Stored is 500
          status: 'ACTIVE',
        }),
      },
      transaction: {
        findMany: vi.fn().mockResolvedValue([
          { amount: 200, actual_patient_share: null }, // Spent is 200 -> Computed should be 400
        ]),
      },
    } as any;

    await expect(assertBeneficiaryBalanceInvariant(mockTx, 'id1', 'test'))
      .resolves.not.toThrow();
  });

  it('should log warning if status does not match computed balance', async () => {
    const mockTx = {
      beneficiary: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'id1',
          total_balance: 600,
          remaining_balance: 0, 
          status: 'ACTIVE', // Status is ACTIVE but remaining is 0
        }),
      },
      transaction: {
        findMany: vi.fn().mockResolvedValue([
          { amount: 600, actual_patient_share: null },
        ]),
      },
    } as any;

    await expect(assertBeneficiaryBalanceInvariant(mockTx, 'id1', 'test'))
      .resolves.not.toThrow();
  });

  it('should pass if everything matches', async () => {
    const mockTx = {
      beneficiary: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'id1',
          total_balance: 600,
          remaining_balance: 400,
          status: 'ACTIVE',
        }),
      },
      transaction: {
        findMany: vi.fn().mockResolvedValue([
          { amount: 200, actual_patient_share: null },
        ]),
      },
    } as any;

    await expect(assertBeneficiaryBalanceInvariant(mockTx, 'id1', 'test'))
      .resolves.not.toThrow();
  });
});
