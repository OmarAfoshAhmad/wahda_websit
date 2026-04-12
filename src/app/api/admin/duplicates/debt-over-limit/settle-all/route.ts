import { NextResponse } from "next/server";
import { requireActiveFacilitySession } from "@/lib/session-guard";
import { applyOverdrawnDebtSettlement } from "@/lib/overdrawn-debt-settlement";

export async function POST(request: Request) {
  const session = await requireActiveFacilitySession();
  if (!session) {
    return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
  }

  if (!session.is_admin) {
    return NextResponse.json({ error: "غير مصرح بهذه العملية" }, { status: 403 });
  }

  try {
    const result = await applyOverdrawnDebtSettlement({
      user: session.username,
      facilityId: session.id,
    });

    const redirectUrl = new URL("/admin/duplicates", request.url);
    redirectUrl.searchParams.set("tab", "debt");
    redirectUrl.searchParams.set(
      "ok",
      `تمت المعالجة: ${result.affectedDebtors} حالة، تم التوافق ${result.settledDebtors}، متبقي ${result.unresolvedDebtors}`
    );
    redirectUrl.searchParams.set("debtAudit", result.auditId);

    return NextResponse.redirect(redirectUrl, { status: 303 });
  } catch {
    const redirectUrl = new URL("/admin/duplicates", request.url);
    redirectUrl.searchParams.set("tab", "debt");
    redirectUrl.searchParams.set("err", "تعذر تنفيذ تسوية المديونية حالياً");
    return NextResponse.redirect(redirectUrl, { status: 303 });
  }
}
