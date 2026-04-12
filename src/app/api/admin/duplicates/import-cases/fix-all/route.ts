import { NextResponse } from "next/server";
import { requireActiveFacilitySession } from "@/lib/session-guard";
import { applyActiveImportDuplicateFix } from "@/lib/import-duplicate-cases";

export async function POST(request: Request) {
  const session = await requireActiveFacilitySession();
  if (!session) {
    return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
  }

  if (!session.is_admin) {
    return NextResponse.json({ error: "غير مصرح بهذه العملية" }, { status: 403 });
  }

  try {
    const result = await applyActiveImportDuplicateFix({
      user: session.username,
      facilityId: session.id,
    });

    const redirectUrl = new URL("/admin/duplicates", request.url);
    redirectUrl.searchParams.set("tab", "import");
    redirectUrl.searchParams.set(
      "ok",
      `تمت المعالجة بنجاح: ${result.affectedBeneficiaries} مستفيد، ${result.removedTransactions} حركة محذوفة، ${result.totalExtraAmount.toLocaleString("en-US")} د.ل`
    );

    return NextResponse.redirect(redirectUrl, { status: 303 });
  } catch {
    const redirectUrl = new URL("/admin/duplicates", request.url);
    redirectUrl.searchParams.set("tab", "import");
    redirectUrl.searchParams.set("err", "تعذر تنفيذ المعالجة الدفعة الواحدة حالياً");
    return NextResponse.redirect(redirectUrl, { status: 303 });
  }
}
