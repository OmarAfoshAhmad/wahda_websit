import { describe, it, expect, vi, beforeEach } from 'vitest';
import { deductBalance } from '../app/actions/deduction';
import prisma from '../lib/prisma';

// Mocking dependencies
vi.mock('../lib/prisma', () => ({
  default: {
    $transaction: vi.fn((callback) => callback(prisma)),
    $queryRaw: vi.fn(),
    facility: {
      findFirst: vi.fn(),
    },
    transaction: {
      findUnique: vi.fn(),
      create: vi.fn(),
      aggregate: vi.fn().mockResolvedValue({ _sum: {} }),
    },
    beneficiary: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    notification: {
      create: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
    insuranceCompany: {
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
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

vi.mock('../lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue(null),
}));

vi.mock('../lib/sse-notifications', () => ({
  emitNotification: vi.fn(),
}));

vi.mock('../lib/logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

// الرصيد يُحسب من الدفتر: نحاكي دفتراً بسيطاً (ledgerSpent) يُضاف إليه كل خصم مُنشأ.
const ledger = { total: 0, spent: 0, status: 'ACTIVE' as 'ACTIVE' | 'FINISHED' | 'SUSPENDED' };
vi.mock('../lib/tx-balance-guard', () => ({
  assertBeneficiaryBalanceInvariant: vi.fn().mockResolvedValue(undefined),
  buildIdempotencyKey: vi.fn().mockReturnValue(null),
  calculateBeneficiaryBalance: vi.fn(async () => ({
    remaining_balance: ledger.total - ledger.spent,
    total_balance: ledger.total,
    status: ledger.total - ledger.spent <= 0 ? 'FINISHED' : 'ACTIVE',
    name: 'Omar',
    card_number: 'WAB2025123',
  })),
  settleBeneficiaryBalance: vi.fn(async (_tx: unknown, id: string, options?: { completedVia?: string }) => {
    const before = ledger.total - ledger.spent;
    const created = (prisma.transaction.create as any).mock.calls.at(-1)?.[0]?.data;
    if (created) ledger.spent += Number(created.actual_company_share ?? created.amount);
    const after = ledger.total - ledger.spent;
    const statusAfter = after <= 0 ? 'FINISHED' : 'ACTIVE';
    await prisma.beneficiary.update({
      where: { id },
      data: { remaining_balance: after, status: statusAfter, ...(statusAfter === 'FINISHED' && options?.completedVia ? { completed_via: options.completedVia } : {}) },
    });
    return { balanceBefore: before, balanceAfter: after, statusBefore: ledger.status, statusAfter };
  }),
}));

vi.mock('../lib/card-number', () => ({
  normalizeCardInput: vi.fn((v: string) => v.trim().toUpperCase()),
}));

describe('deductBalance Action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ledger.total = 0;
    ledger.spent = 0;
    ledger.status = 'ACTIVE';
  });

  it('should successfully deduct balance when input is valid', async () => {
    const mockBeneficiary = {
      id: 'ben1',
      name: 'Omar',
      card_number: 'WAB2025123',
      company_id: null,
      remaining_balance: 500.0,
      total_balance: 1000.0,
      status: 'ACTIVE',
    };

    ledger.total = 1000;
    ledger.spent = 500;
    (prisma.$queryRaw as any).mockResolvedValueOnce([mockBeneficiary]);
    (prisma.transaction.create as any).mockResolvedValueOnce({ id: 'tx1', amount: 100.0, created_at: new Date() });
    (prisma.notification.create as any).mockResolvedValueOnce({ id: 'notif1' });
    (prisma.auditLog.create as any).mockResolvedValueOnce({ id: 'audit1' });

    const result = await deductBalance({
      card_number: 'WAB2025123',
      amount: 100.0,
      type: 'MEDICINE',
    });

    expect(result.success).toBe(true);
    expect(result.newBalance).toBe(400.0);
    
    // Verify beneficiary update
    expect(prisma.beneficiary.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'ben1' },
      data: expect.objectContaining({
        remaining_balance: 400.0,
        status: 'ACTIVE',
      }),
    }));
  });

  it('should throw error if amount exceeds remaining balance', async () => {
    const mockBeneficiary = {
      id: 'ben1',
      name: 'Omar',
      card_number: 'WAB2025123',
      company_id: null,
      remaining_balance: 50.0,
      total_balance: 100.0,
      status: 'ACTIVE',
    };

    ledger.total = 100;
    ledger.spent = 50;
    (prisma.$queryRaw as any).mockResolvedValueOnce([mockBeneficiary]);

    const result = await deductBalance({
      card_number: 'WAB2025123',
      amount: 100.0,
      type: 'MEDICINE',
    });

    expect(result.success).toBeUndefined();
    expect(result.error).toContain('أكبر من الرصيد المتاح');
    expect(prisma.transaction.create).not.toHaveBeenCalled();
  });

  it('should prevent deduction from SUSPENDED beneficiaries', async () => {
    const mockBeneficiary = {
      id: 'ben1',
      name: 'Omar',
      card_number: 'WAB2025123',
      company_id: null,
      remaining_balance: 100.0,
      total_balance: 100.0,
      status: 'SUSPENDED',
    };

    (prisma.$queryRaw as any).mockResolvedValueOnce([mockBeneficiary]);

    const result = await deductBalance({
      card_number: 'WAB2025123',
      amount: 10.0,
      type: 'MEDICINE',
    });

    expect(result.error).toBe('حساب المستفيد موقوف ولا يمكن إجراء خصم عليه');
  });

  it('should set status to FINISHED and completed_via to MANUAL when balance reaches zero', async () => {
    const mockBeneficiary = {
      id: 'ben1',
      name: 'Omar',
      card_number: 'WAB2025123',
      company_id: null,
      remaining_balance: 100.0,
      total_balance: 100.0,
      status: 'ACTIVE',
    };

    ledger.total = 100;
    ledger.spent = 0;
    (prisma.$queryRaw as any).mockResolvedValueOnce([mockBeneficiary]);
    (prisma.transaction.create as any).mockResolvedValueOnce({ id: 'tx1', amount: 100.0, created_at: new Date() });
    (prisma.notification.create as any).mockResolvedValueOnce({ id: 'notif1' });
    (prisma.auditLog.create as any).mockResolvedValueOnce({ id: 'audit1' });

    const result = await deductBalance({
      card_number: 'WAB2025123',
      amount: 100.0,
      type: 'MEDICINE',
    });

    expect(result.success).toBe(true);
    expect(result.newBalance).toBe(0);
    expect(prisma.beneficiary.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'FINISHED',
        completed_via: 'MANUAL',
      }),
    }));
  });
});
