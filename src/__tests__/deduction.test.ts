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
      aggregate: vi.fn(),
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
    servicePolicy: {
      findUnique: vi.fn().mockResolvedValue(null),
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

vi.mock('../lib/tx-balance-guard', () => ({
  assertBeneficiaryBalanceInvariant: vi.fn().mockResolvedValue(undefined),
  buildIdempotencyKey: vi.fn().mockReturnValue(null),
}));

vi.mock('../lib/card-number', () => ({
  normalizeCardInput: vi.fn((v: string) => v.trim().toUpperCase()),
}));

describe('deductBalance Action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

    // Mock row-level lock query
    (prisma.$queryRaw as any).mockResolvedValueOnce([mockBeneficiary]);
    
    // Mock spent aggregation
    (prisma.transaction.aggregate as any).mockResolvedValueOnce({
      _sum: { amount: 500.0 },
    });

    // Mock success transaction creation
    (prisma.transaction.create as any).mockResolvedValueOnce({ id: 'tx1', amount: 100.0, created_at: new Date() });
    (prisma.notification.create as any).mockResolvedValueOnce({ id: 'notif1' });
    // Mock drift-check aggregate (2nd call inside the transaction)
    (prisma.transaction.aggregate as any).mockResolvedValueOnce({
      _sum: { amount: 600.0 },
    });
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

    (prisma.$queryRaw as any).mockResolvedValueOnce([mockBeneficiary]);
    (prisma.transaction.aggregate as any).mockResolvedValue({ _sum: { amount: 0 } });

    const result = await deductBalance({
      card_number: 'WAB2025123',
      amount: 100.0,
      type: 'MEDICINE',
    });

    expect(result.success).toBeUndefined();
    expect(result.error).toContain('حصة المستفيد');
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

    (prisma.$queryRaw as any).mockResolvedValueOnce([mockBeneficiary]);
    (prisma.transaction.aggregate as any).mockResolvedValueOnce({
      _sum: { amount: 0 },
    });
    (prisma.transaction.create as any).mockResolvedValueOnce({ id: 'tx1', amount: 100.0, created_at: new Date() });
    (prisma.notification.create as any).mockResolvedValueOnce({ id: 'notif1' });
    // Mock drift-check aggregate (2nd call inside the transaction)
    (prisma.transaction.aggregate as any).mockResolvedValueOnce({
      _sum: { amount: 100.0 },
    });
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
