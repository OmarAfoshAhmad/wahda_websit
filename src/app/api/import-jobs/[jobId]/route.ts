import { NextResponse } from "next/server";
import { requireActiveFacilitySession } from "@/lib/session-guard";
import { getImportJobSnapshot } from "@/lib/import-jobs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const session = await requireActiveFacilitySession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { jobId } = await params;
  // المشرف يرى أي job — المرافق ترى فقط jobs حسابها
  const job = await getImportJobSnapshot(
    jobId,
    session.is_admin ? undefined : session.username
  );
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  return NextResponse.json({ job });
}