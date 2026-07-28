import { NextResponse } from "next/server";
import { requireActiveFacilitySession } from "@/lib/session-guard";
import { getImportJobSkippedRowsWorkbook } from "@/lib/import-jobs";
import { requireImportJobAccess, ScopeAccessError } from "@/lib/company-scope";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> }
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
  const report = await getImportJobSkippedRowsWorkbook(
    jobId,
    session.role_v2 === "SUPER_ADMIN" ? undefined : session.username
  );

  if (!report) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  if (report.empty) {
    return NextResponse.json({ error: "لا توجد حالات غير مستوردة لهذه المهمة." }, { status: 404 });
  }

  return new NextResponse(report.buffer, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${report.fileName}"`,
      "Cache-Control": "no-store",
    },
  });
}
