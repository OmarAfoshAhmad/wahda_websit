import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cancelTransaction } from '../app/actions/cancel-transaction';
import prisma from '../lib/prisma';

vi.mock('../lib/prisma', () => ({
  default: {
    $transaction: vi.fn((callback) => callback(prisma)),
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
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

// دفتر مُحاكى: الإلغاء يُخرج الحركة من الدفتر فيرتفع الرصيد المحسوب.
const ledger = { total: 0, spent: 0, status: 'ACTIVE' as 'ACTIVE' | 'FINISHED' | 'SUSPENDED', cancelledShare: 0 };
vi.mock('../lib/tx-balance-guard', () => ({
  assertBeneficiaryBalanceInvariant: vi.fn().mockResolvedValue(undefined),
  calculateBeneficiaryBalance: vi.fn(),
  settleBeneficiaryBalance: vi.fn(async (_tx: unknown, id: string) => {
    const before = ledger.total - ledger.spent;
    ledger.spent -= ledger.cancelledShare;
    const after = ledger.total - ledger.spent;
    const statusAfter = ledger.status === 'SUSPENDED' ? 'SUSPENDED' : after <= 0 ? 'FINISHED' : 'ACTIVE';
    await prisma.beneficiary.update({ where: { id }, data: { remaining_balance: after, status: statusAfter } });
    return { balanceBefore: before, balanceAfter: after, statusBefore: ledger.status, statusAfter };
  }),
}));

vi.mock('../lib/logger', () => ({
  logger: { error: vi.fn() },
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

const baseTx = {
  id: 'tx1',
  beneficiary_id: 'ben1',
  amount: 100.0,
  actual_company_share: null,
  ceiling_consumed: null,
  company_id: null,
  service_category: null,
  is_cancelled: false,
  created_at: new Date('2026-05-10T12:00:00.000Z'),
  beneficiary: { id: 'ben1', name: 'Omar', card_number: 'WAB2025123' },
};

function arrange(tx: Record<string, unknown>) {
  (prisma.$queryRaw as any)
    .mockResolvedValueOnce([{ is_cancelled: tx.is_cancelled, type: tx.type }])
    .mockResolvedValueOnce([{ id: 'ben1' }]);
  (prisma.transaction.findUnique as any).mockResolvedValueOnce(tx);
  (prisma.transaction.create as any).mockResolvedValueOnce({ id: 'tx-cancel' });
}

describe('cancelTransaction Action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ledger.total = 1000;
    ledger.spent = 600;
    ledger.status = 'ACTIVE';
    ledger.cancelledShare = 0;
  });

  it('refunds a base-balance transaction by recomputing from the ledger', async () => {
    ledger.cancelledShare = 100;
    arrange({ ...baseTx, type: 'MEDICINE' });

    const result = (await cancelTransaction('tx1')) as any;

    expect(result.success).toBe(true);
    expect(result.details?.balance_before).toBe(400);
    expect(result.details?.balance_after).toBe(500);
    expect(prisma.beneficiary.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'ben1' },
      data: expect.objectContaining({ remaining_balance: 500, status: 'ACTIVE' }),
    }));
  });

  it('does not touch the base balance when cancelling an isolated service', async () => {
    // حركة بصريات لم تُخصم من الدفتر الأساسي أصلاً، فإلغاؤها لا يغيّره.
    ledger.cancelledShare = 0;
    arrange({ ...baseTx, type: 'OPTICS' });

    const result = (await cancelTransaction('tx1')) as any;

    expect(result.success).toBe(true);
    expect(result.details?.balance_before).toBe(400);
    expect(result.details?.balance_after).toBe(400);
  });

  it('keeps SUSPENDED status after a refund', async () => {
    ledger.status = 'SUSPENDED';
    ledger.cancelledShare = 100;
    arrange({ ...baseTx, type: 'MEDICINE' });

    const result = await cancelTransaction('tx1');

    expect(result.success).toBe(true);
    expect(prisma.beneficiary.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'SUSPENDED' }),
    }));
  });

  it('rejects an already cancelled transaction', async () => {
    (prisma.$queryRaw as any).mockResolvedValueOnce([{ is_cancelled: true, type: 'MEDICINE' }]);

    const result = await cancelTransaction('tx1');

    expect(result.error).toBe('المعاملة ملغاة بالفعل');
    expect(prisma.beneficiary.update).not.toHaveBeenCalled();
  });

  it('rejects cancelling a cancellation row', async () => {
    (prisma.$queryRaw as any).mockResolvedValueOnce([{ is_cancelled: false, type: 'CANCELLATION' }]);

    const result = await cancelTransaction('tx1');

    expect(result.error).toBe('لا يمكن إلغاء معاملة إلغاء');
  });
});
