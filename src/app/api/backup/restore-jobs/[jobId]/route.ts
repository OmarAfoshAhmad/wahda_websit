import { NextResponse } from "next/server";
import { requireActiveFacilitySession } from "@/lib/session-guard";
import { cancelRestoreJob, resumeRestoreJobIfNeeded } from "@/lib/restore-jobs";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const session = await requireActiveFacilitySession();
  if (!session || !session.is_admin) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const { jobId } = await params;
  const job = await resumeRestoreJobIfNeeded(jobId, session.username);

  if (!job) {
    return NextResponse.json({ error: "لم يتم العثور على مهمة الاستعادة" }, { status: 404 });
  }

  return NextResponse.json({ job });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const session = await requireActiveFacilitySession();
  if (!session || !session.is_admin) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const { action } = (await request.json().catch(() => ({}))) as { action?: string };
  if (action !== "cancel") {
    return NextResponse.json({ error: "الإجراء غير مدعوم" }, { status: 400 });
  }

  const { jobId } = await params;
  const job = await cancelRestoreJob(jobId, session.username);
  if (!job) {
    return NextResponse.json({ error: "لم يتم العثور على مهمة الاستعادة" }, { status: 404 });
  }

  return NextResponse.json({ success: true, job });
}
