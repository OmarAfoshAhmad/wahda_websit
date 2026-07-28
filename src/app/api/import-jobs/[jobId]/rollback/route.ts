import { NextResponse } from "next/server";
import { requireActiveFacilitySession } from "@/lib/session-guard";
import { rollbackImportJob } from "@/lib/import-jobs";
import { requireImportJobAccess, ScopeAccessError } from "@/lib/company-scope";
import { hasPermission } from "@/lib/permissions";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const session = await requireActiveFacilitySession();
  if (!session) {
    return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
  }
  if (!hasPermission(session, "import_beneficiaries")) {
    return NextResponse.json({ error: "لا تملك صلاحية استيراد المستفيدين" }, { status: 403 });
  }

  const { jobId } = await params;
  try {
    await requireImportJobAccess(session, jobId);
  } catch (error) {
    const status = error instanceof ScopeAccessError ? error.status : 403;
    return NextResponse.json({ error: error instanceof Error ? error.message : "ممنوع" }, { status });
  }
  const result = await rollbackImportJob(jobId, session.username);

  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json(result);
}
