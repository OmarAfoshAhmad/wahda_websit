import { NextResponse } from "next/server";
import { requireActiveFacilitySession } from "@/lib/session-guard";
import { processTransactionImportJob } from "@/lib/transaction-import-jobs";
import { enqueueTransactionImportJob } from "@/lib/queue";
import { logger } from "@/lib/logger";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> },
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
    const queued = await enqueueTransactionImportJob(jobId, session.username);

    if (!queued) {
      logger.warn("BullMQ unavailable — falling back to fire-and-forget for transaction import job", { jobId });
      void Promise.resolve()
        .then(() => processTransactionImportJob(jobId, session.username))
        .catch((err: unknown) => {
          logger.error("Transaction import job uncaught error (fallback)", { jobId, error: String(err) });
        });
    }

    return NextResponse.json({ accepted: true, jobId, queued, mode: queued ? "queue" : "fallback" }, { status: 202 });
  } catch (error) {
    logger.error("Failed to start transaction import job", { jobId, error: String(error) });
    return NextResponse.json({ error: "تعذر بدء مهمة استيراد الحركات." }, { status: 500 });
  }
}
