import { NextResponse } from "next/server";
import { requireActiveFacilitySession } from "@/lib/session-guard";
import { rollbackImportJob } from "@/lib/import-jobs";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const session = await requireActiveFacilitySession();
  if (!session) {
    return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
  }
  if (!session.is_admin) {
    return NextResponse.json({ error: "ممنوع — المبرمجون فقط" }, { status: 403 });
  }

  const { jobId } = await params;
  const result = await rollbackImportJob(jobId, session.username);

  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json(result);
}
