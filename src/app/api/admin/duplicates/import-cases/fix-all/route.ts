import { NextResponse } from "next/server";
import { requireActiveFacilitySession } from "@/lib/session-guard";
import { startMaintenanceJobForActor } from "@/app/actions/maintenance-jobs";

export async function POST(request: Request) {
  const session = await requireActiveFacilitySession();
  if (!session) {
    return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
  }

  if (!session.is_admin) {
    return NextResponse.json({ error: "غير مصرح بهذه العملية" }, { status: 403 });
  }

  try {
    const queued = await startMaintenanceJobForActor(
      {
        kind: "fix_duplicate_import_cases",
        facilityId: session.id,
      },
      {
        id: session.id,
        username: session.username,
        isAdmin: session.is_admin || session.is_manager,
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
    redirectUrl.searchParams.set("ok", "تمت جدولة معالجة حالات تكرار IMPORT في الخلفية");
    redirectUrl.searchParams.set("job", queued.job.id);

    return NextResponse.redirect(redirectUrl, { status: 303 });
  } catch {
    const redirectUrl = new URL("/admin/duplicates", request.url);
    redirectUrl.searchParams.set("tab", "import");
    redirectUrl.searchParams.set("err", "تعذر تنفيذ المعالجة الدفعة الواحدة حالياً");
    return NextResponse.redirect(redirectUrl, { status: 303 });
  }
}
