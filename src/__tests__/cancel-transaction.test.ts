import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cancelTransaction } from '../app/actions/cancel-transaction';
import prisma from '../lib/prisma';

vi.mock('../lib/prisma', () => ({
  default: {
    $transaction: vi.fn((callback) => callback(prisma)),
    $queryRaw: vi.fn(),
    transaction: {
      findUnique: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
    beneficiary: {
      update: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
  },
}));

vi.mock('../lib/session-guard', () => ({
  requireActiveFacilitySession: vi.fn().mockResolvedValue({
    id: 'fac1',
    name: 'Test Facility',
    username: 'admin',
    is_admin: true,
  }),
  hasPermission: vi.fn().mockReturnValue(true),
}));

vi.mock('../lib/tx-balance-guard', () => ({
  assertBeneficiaryBalanceInvariant: vi.fn().mockResolvedValue(true),
}));

vi.mock('../lib/logger', () => ({
  logger: {
    error: vi.fn(),
  },
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

describe('cancelTransaction Action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should successfully cancel a transaction and refund balance', async () => {
    const mockTx = {
      id: 'tx1',
      beneficiary_id: 'ben1',
      amount: 100.0,
      is_cancelled: false,
      type: 'MEDICINE',
      beneficiary: { id: 'ben1', name: 'Omar', card_number: 'WAB2025123' },
    };

    (prisma.transaction.findUnique as any).mockResolvedValueOnce(mockTx);
    (prisma.$queryRaw as any).mockResolvedValueOnce([{ id: 'ben1', remaining_balance: 400.0, status: 'ACTIVE' }]);
    (prisma.transaction.create as any).mockResolvedValueOnce({ id: 'tx-cancel' });

    const result = (await cancelTransaction('tx1')) as any;

    expect(result.success).toBe(true);
    expect(result.details?.balance_after).toBe(500.0);
    
    expect(prisma.beneficiary.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'ben1' },
      data: expect.objectContaining({
        remaining_balance: 500.0,
        status: 'ACTIVE',
      }),
    }));
  });

  it('should not change status from SUSPENDED even after refund', async () => {
    const mockTx = {
      id: 'tx1',
      beneficiary_id: 'ben1',
      amount: 100.0,
      is_cancelled: false,
      type: 'MEDICINE',
      beneficiary: { id: 'ben1', name: 'Omar', card_number: 'WAB2025123' },
    };

    (prisma.transaction.findUnique as any).mockResolvedValueOnce(mockTx);
    (prisma.$queryRaw as any).mockResolvedValueOnce([{ id: 'ben1', remaining_balance: 0.0, status: 'SUSPENDED' }]);
    (prisma.transaction.create as any).mockResolvedValueOnce({ id: 'tx-cancel' });

    const result = await cancelTransaction('tx1');

    expect(result.success).toBe(true);
    expect(prisma.beneficiary.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'SUSPENDED',
      }),
    }));
  });

  it('should throw error if transaction is already cancelled', async () => {
    const mockTx = {
      id: 'tx1',
      is_cancelled: true,
    };

    (prisma.transaction.findUnique as any).mockResolvedValueOnce(mockTx);

    const result = await cancelTransaction('tx1');

    expect(result.error).toBe('المعاملة ملغاة بالفعل');
  });

  it('should throw error if trying to cancel a cancellation', async () => {
    const mockTx = {
      id: 'tx1',
      is_cancelled: false,
      type: 'CANCELLATION',
    };

    (prisma.transaction.findUnique as any).mockResolvedValueOnce(mockTx);

    const result = await cancelTransaction('tx1');

    expect(result.error).toBe('لا يمكن إلغاء معاملة إلغاء');
  });
});
