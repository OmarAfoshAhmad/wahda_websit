import { NextResponse } from "next/server";
import { requireActiveFacilitySession } from "@/lib/session-guard";
import { wakePostgresImportWorker } from "@/lib/postgres-import-worker";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const session = await requireActiveFacilitySession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!session.is_admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { jobId } = await params;

  try {
    wakePostgresImportWorker();
    return NextResponse.json({ accepted: true, jobId, queued: true, mode: "postgres" }, { status: 202 });
  } catch (error) {
    console.error("Failed to start import job", { jobId, error: String(error) });
    return NextResponse.json({ error: "تعذر بدء مهمة الاستيراد." }, { status: 500 });
  }
}
