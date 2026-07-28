import { NextResponse } from "next/server";
import { requireActiveFacilitySession } from "@/lib/session-guard";
import { mergeAllGlobalZeroVariantsAction } from "@/app/actions/beneficiary";
import { assertCompanyAccessForSession } from "@/lib/company-scope";

export async function POST(request: Request) {
  const session = await requireActiveFacilitySession();
  if (!session) {
    return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
  }

  if (session.role_v2 !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "غير مصرح بهذه العملية" }, { status: 403 });
  }

  try {
    const body = await request.json().catch(() => null) as { companyId?: unknown } | null;
    const companyId = typeof body?.companyId === "string" ? body.companyId.trim() : "";
    if (!companyId) return NextResponse.json({ error: "يجب تحديد الشركة" }, { status: 400 });
    await assertCompanyAccessForSession(session, companyId);
    const result = await mergeAllGlobalZeroVariantsAction(companyId);
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      mergedGroups: Number(result.mergedGroups ?? 0),
      mergedRows: Number(result.mergedRows ?? 0),
      truncatedCount: Number(result.truncatedCount ?? 0),
      firstAuditId: result.firstAuditId ?? null,
    });
  } catch (error) {
    console.error("[api/admin/duplicates/merge-all-safe]", error);
    return NextResponse.json({ error: "تعذر تنفيذ الدمج الآمن حالياً" }, { status: 500 });
  }
}
