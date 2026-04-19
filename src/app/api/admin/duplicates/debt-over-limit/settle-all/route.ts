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
        kind: "settle_overdrawn_debt",
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
    redirectUrl.searchParams.set("tab", "debt");
    redirectUrl.searchParams.set("ok", "تمت جدولة تسوية المديونية في الخلفية");
    redirectUrl.searchParams.set("job", queued.job.id);
    return NextResponse.redirect(redirectUrl, { status: 303 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "تعذر تنفيذ تسوية المديونية حالياً";
    const redirectUrl = new URL("/admin/duplicates", request.url);
    redirectUrl.searchParams.set("tab", "debt");
    redirectUrl.searchParams.set("err", `تعذر تنفيذ تسوية المديونية: ${message}`);
    return NextResponse.redirect(redirectUrl, { status: 303 });
  }
}
