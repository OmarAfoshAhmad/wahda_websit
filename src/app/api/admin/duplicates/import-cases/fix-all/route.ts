import { NextResponse } from "next/server";
import { requireActiveFacilitySession } from "@/lib/session-guard";
import { startMaintenanceJobForActor } from "@/app/actions/maintenance-jobs";
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
    const formData = await request.formData().catch(() => null);
    const companyId = String(formData?.get("companyId") ?? "").trim();
    if (!companyId) return NextResponse.json({ error: "يجب تحديد الشركة" }, { status: 400 });
    await assertCompanyAccessForSession(session, companyId);
    const queued = await startMaintenanceJobForActor(
      {
        kind: "fix_duplicate_import_cases",
        facilityId: session.id,
        companyId,
      },
      {
        id: session.id,
        username: session.username,
        isAdmin: true,
      },
    );

    if (!queued.success || !queued.job) {
      return NextResponse.json(
        { success: false, error: queued.error ?? "تعذر إنشاء مهمة الخلفية" },
        { status: 403 },
      );
    }

    const redirectUrl = new URL("/admin/duplicates", request.url);
    redirectUrl.searchParams.set("tab", "import");
    redirectUrl.searchParams.set("companyId", companyId);
    redirectUrl.searchParams.set("ok", "تمت جدولة معالجة حالات تكرار IMPORT في الخلفية");
    redirectUrl.searchParams.set("job", queued.job.id);

    return NextResponse.redirect(redirectUrl, { status: 303 });
  } catch (error) {
    console.error("[api/admin/duplicates/import-cases/fix-all]", error);
    const redirectUrl = new URL("/admin/duplicates", request.url);
    redirectUrl.searchParams.set("tab", "import");
    redirectUrl.searchParams.set("err", "تعذر تنفيذ المعالجة الدفعة الواحدة حالياً");
    return NextResponse.redirect(redirectUrl, { status: 303 });
  }
}
