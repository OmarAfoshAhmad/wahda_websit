import { NextResponse } from "next/server";
import { requireActiveFacilitySession } from "@/lib/session-guard";
import { mergeAllGlobalZeroVariantsAction } from "@/app/actions/beneficiary";

export async function POST() {
  const session = await requireActiveFacilitySession();
  if (!session) {
    return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
  }

  if (!session.is_admin) {
    return NextResponse.json({ error: "غير مصرح بهذه العملية" }, { status: 403 });
  }

  try {
    const result = await mergeAllGlobalZeroVariantsAction();
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
  } catch {
    return NextResponse.json({ error: "تعذر تنفيذ الدمج الآمن حالياً" }, { status: 500 });
  }
}
