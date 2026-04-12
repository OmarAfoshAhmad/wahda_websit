import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireActiveFacilitySession } from "@/lib/session-guard";
import { exportOverdrawnDebtCasesExcel, getOverdrawnDebtCases, type OverdrawnDebtCase } from "@/lib/overdrawn-debt-settlement";

export async function GET(request: Request) {
  const session = await requireActiveFacilitySession();
  if (!session) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  if (!session.is_admin) {
    return NextResponse.json({ error: "ممنوع — المبرمجون فقط" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const mode = searchParams.get("mode") === "after" ? "after" : "before";
  const auditId = searchParams.get("auditId") ?? "";

  let cases: OverdrawnDebtCase[] = [];
  let title = "تقرير قبل المعالجة";

  if (mode === "before") {
    cases = await getOverdrawnDebtCases();
    title = "تقرير قبل المعالجة";
  } else {
    let audit = null;
    if (auditId) {
      audit = await prisma.auditLog.findFirst({
        where: { id: auditId, action: "SETTLE_OVERDRAWN_FAMILY_DEBT" },
        select: { metadata: true, created_at: true },
      });
    }

    if (!audit) {
      audit = await prisma.auditLog.findFirst({
        where: { action: "SETTLE_OVERDRAWN_FAMILY_DEBT" },
        select: { metadata: true, created_at: true },
        orderBy: { created_at: "desc" },
      });
    }

    const metadata = (audit?.metadata ?? {}) as Record<string, unknown>;
    const afterCases = Array.isArray(metadata.afterCases) ? metadata.afterCases : [];
    cases = afterCases as OverdrawnDebtCase[];
    title = "تقرير بعد المعالجة";
  }

  const buffer = await exportOverdrawnDebtCasesExcel(cases, title);
  const suffix = mode === "after" ? "after" : "before";
  const fileName = `debt-over-limit-${suffix}-${new Date().toISOString().slice(0, 10)}.xlsx`;

  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store",
    },
  });
}
