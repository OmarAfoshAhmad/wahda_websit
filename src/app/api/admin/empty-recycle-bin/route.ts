import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireActiveFacilitySession } from "@/lib/session-guard";
import { logger } from "@/lib/logger";
import { revalidatePath, revalidateTag } from "next/cache";

export async function POST() {
  // FIX SEC-02: استخدام requireActiveFacilitySession بدلاً من getSession
  // يضمن رفض المرافق المحذوفة ناعمياً حتى لو لا تزال تحمل JWT صالح
  const session = await requireActiveFacilitySession();
  if (!session || !session.is_admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // حذف آمن: نحذف التوابع أولاً ثم المستفيد داخل نفس المعاملة
    // لتفادي قيود FK من نوع RESTRICT (مثل WalletConsumption / Claim).
    const result = await prisma.$queryRaw<{ deleted_count: number }[]>`
      WITH candidates AS (
        SELECT b.id
        FROM "Beneficiary" b
        WHERE b.deleted_at IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM "Transaction" t
            WHERE t.beneficiary_id = b.id
          )
      ),
      deleted_wallet AS (
        DELETE FROM "WalletConsumption" wc
        USING candidates c
        WHERE wc.beneficiary_id = c.id
      ),
      deleted_claims AS (
        DELETE FROM "Claim" cl
        USING candidates c
        WHERE cl.beneficiary_id = c.id
      ),
      deleted_notifications AS (
        DELETE FROM "Notification" n
        USING candidates c
        WHERE n.beneficiary_id = c.id
      ),
      deleted_beneficiaries AS (
        DELETE FROM "Beneficiary" b
        USING candidates c
        WHERE b.id = c.id
        RETURNING b.id
      )
      SELECT COUNT(*)::int AS deleted_count
      FROM deleted_beneficiaries
    `;

    const deletedCount = Number(result?.[0]?.deleted_count ?? 0);

    if (deletedCount > 0) {
      await prisma.auditLog.create({
        data: {
          action: "EMPTY_RECYCLE_BIN",
          user: session.username,
          facility_id: session.id,
          metadata: {
            deleted_count: deletedCount,
            timestamp: new Date().toISOString(),
          },
        },
      });

      revalidatePath("/beneficiaries");
      revalidateTag("beneficiary-counts", "max");
    }

    return NextResponse.json({ success: true, count: deletedCount });
  } catch (error) {
    logger.error("Empty recycle bin error", { error });
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
