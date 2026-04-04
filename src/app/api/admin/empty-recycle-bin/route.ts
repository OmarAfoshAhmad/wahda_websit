import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireActiveFacilitySession } from "@/lib/session-guard";
import { hasPermission } from "@/lib/session-guard";
import { logger } from "@/lib/logger";
import { revalidatePath } from "next/cache";

export async function POST() {
  // FIX SEC-02: استخدام requireActiveFacilitySession بدلاً من getSession
  // يضمن رفض المرافق المحذوفة ناعمياً حتى لو لا تزال تحمل JWT صالح
  const session = await requireActiveFacilitySession();
  if (!session || !hasPermission(session, "delete_beneficiary")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // FIX PERF-03: حذف مباشر بـ SQL بدلاً من جلب الكل في الذاكرة ثم الفلترة
    // يستخدم subquery لاستبعاد المستفيدين الذين لديهم معاملات
    const result = await prisma.$executeRaw`
      DELETE FROM "Beneficiary"
      WHERE deleted_at IS NOT NULL
        AND id NOT IN (
          SELECT DISTINCT beneficiary_id FROM "Transaction"
        )
    `;

    // result = عدد الصفوف المحذوفة
    const deletedCount = Number(result);

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
    }

    return NextResponse.json({ success: true, count: deletedCount });
  } catch (error) {
    logger.error("Empty recycle bin error", { error });
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
