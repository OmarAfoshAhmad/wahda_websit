import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { roundCurrency } from "@/lib/money";

/**
 * POST /api/import-transactions/[logId]/rollback
 * 
 * التراجع عن عملية استيراد حركات بناءً على audit log ID.
 * يستخدم appliedRows المخزنة في metadata لاسترجاع الأرصدة وحذف الحركات.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ logId: string }> },
) {
  const session = await getSession();
  if (!session?.is_admin) {
    return NextResponse.json({ error: "غير مصرح" }, { status: 403 });
  }

  const { logId } = await params;

  // 1. جلب سجل المراجعة
  const auditLog = await prisma.auditLog.findUnique({
    where: { id: logId },
  });

  if (!auditLog || auditLog.action !== "IMPORT_TRANSACTIONS") {
    return NextResponse.json({ error: "سجل الاستيراد غير موجود" }, { status: 404 });
  }

  const metadata = auditLog.metadata as Record<string, unknown> | null;
  if (!metadata) {
    return NextResponse.json({ error: "بيانات العملية غير موجودة" }, { status: 400 });
  }

  // تحقق أنه لم يتم التراجع مسبقاً
  if (metadata.rolledBack) {
    return NextResponse.json({ error: "تم التراجع عن هذه العملية مسبقاً" }, { status: 400 });
  }

  const appliedRows = metadata.appliedRows as Array<{
    beneficiaryId: string;
    balanceBefore: number;
    deductedAmount: number;
  }> | undefined;

  if (!appliedRows || appliedRows.length === 0) {
    return NextResponse.json({ error: "لا توجد حركات للتراجع عنها" }, { status: 400 });
  }

  const facilityId = auditLog.facility_id;

  // 2. تجميع المستفيدين الفريدين مع رصيدهم الأصلي
  const beneficiaryMap = new Map<string, number>();
  for (const row of appliedRows) {
    // نأخذ أول balanceBefore لأنه الرصيد الحقيقي قبل الاستيراد
    if (!beneficiaryMap.has(row.beneficiaryId)) {
      beneficiaryMap.set(row.beneficiaryId, row.balanceBefore);
    }
  }

  const beneficiaryIds = [...beneficiaryMap.keys()];

  // 3. التراجع داخل transaction
  let restoredCount = 0;
  let deletedTransactions = 0;

  await prisma.$transaction(async (tx) => {
    // حذف حركات IMPORT المرتبطة بهذا المرفق لهؤلاء المستفيدين
    if (facilityId) {
      const deleted = await tx.transaction.deleteMany({
        where: {
          beneficiary_id: { in: beneficiaryIds },
          facility_id: facilityId,
          type: "IMPORT",
          is_cancelled: false,
        },
      });
      deletedTransactions = deleted.count;
    }

    // استعادة الأرصدة
    for (const [beneficiaryId, balanceBefore] of beneficiaryMap) {
      const ben = await tx.beneficiary.findUnique({
        where: { id: beneficiaryId },
        select: { id: true, total_balance: true, status: true },
      });
      if (!ben) continue;

      const totalBalance = Number(ben.total_balance);
      const newRemaining = roundCurrency(balanceBefore);

      await tx.beneficiary.update({
        where: { id: beneficiaryId },
        data: {
          remaining_balance: newRemaining,
          status: newRemaining > 0 ? "ACTIVE" : ben.status,
          completed_via: newRemaining > 0 ? null : undefined,
        },
      });
      restoredCount++;
    }
  });

  // 4. تحديث metadata لتسجيل التراجع
  await prisma.auditLog.update({
    where: { id: logId },
    data: {
      metadata: {
        ...metadata,
        rolledBack: true,
        rollbackDate: new Date().toISOString(),
        rollbackBy: session.username,
        rollbackRestoredCount: restoredCount,
        rollbackDeletedTransactions: deletedTransactions,
      },
    },
  });

  // 5. سجل مراجعة للتراجع
  await prisma.auditLog.create({
    data: {
      facility_id: facilityId,
      user: session.username,
      action: "ROLLBACK_IMPORT_TRANSACTIONS",
      metadata: {
        originalLogId: logId,
        restoredBeneficiaries: restoredCount,
        deletedTransactions,
      },
    },
  });

  return NextResponse.json({
    success: true,
    restoredBeneficiaries: restoredCount,
    deletedTransactions,
  });
}
