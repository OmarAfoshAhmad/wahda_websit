import { NextResponse } from "next/server";
import { requireActiveFacilitySession } from "@/lib/session-guard";
import { processImportJob } from "@/lib/import-jobs";
import { logger } from "@/lib/logger";
import { requireImportJobAccess, ScopeAccessError } from "@/lib/company-scope";
import { hasPermission } from "@/lib/permissions";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const session = await requireActiveFacilitySession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasPermission(session, "import_beneficiaries")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { jobId } = await params;
  try {
    await requireImportJobAccess(session, jobId);
  } catch (error) {
    const status = error instanceof ScopeAccessError ? error.status : 403;
    return NextResponse.json({ error: error instanceof Error ? error.message : "ممنوع" }, { status });
  }

  try {
    // البدء في معالجة المهمة في الخلفية مباشرة بدون طابور
    void Promise.resolve()
      .then(() => processImportJob(jobId, session.username))
      .catch((err: unknown) => {
        logger.error("Import job uncaught error", { jobId, error: String(err) });
      });

    return NextResponse.json({ accepted: true, jobId, mode: "direct" }, { status: 202 });
  } catch (error) {
    logger.error("Failed to start import job", { jobId, error: String(error) });
    return NextResponse.json({ error: "تعذر بدء مهمة الاستيراد." }, { status: 500 });
  }
}
