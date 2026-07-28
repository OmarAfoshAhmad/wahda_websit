import { NextResponse } from "next/server";
import { requireActiveFacilitySession } from "@/lib/session-guard";
import { getTransactionImportJobSnapshot } from "@/lib/transaction-import-jobs";
import { requireImportJobAccess, ScopeAccessError } from "@/lib/company-scope";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const session = await requireActiveFacilitySession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { jobId } = await params;
  try {
    await requireImportJobAccess(session, jobId);
  } catch (error) {
    const status = error instanceof ScopeAccessError ? error.status : 403;
    return NextResponse.json({ error: error instanceof Error ? error.message : "ممنوع" }, { status });
  }
  const job = await getTransactionImportJobSnapshot(jobId, session.role_v2 === "SUPER_ADMIN" ? undefined : session.username);
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  return NextResponse.json({ job });
}
