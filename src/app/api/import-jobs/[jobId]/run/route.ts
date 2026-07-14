import { NextResponse } from "next/server";
import { requireActiveFacilitySession } from "@/lib/session-guard";
import { processImportJob } from "@/lib/import-jobs";
import { enqueueImportJob } from "@/lib/queue";
import { logger } from "@/lib/logger";

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
    // 1. حاول إضافة المهمة للطابور الموثوق (BullMQ + Redis)
    const queued = await enqueueImportJob(jobId, session.username);

    if (!queued) {
      // 2. Fallback للبيئات بدون Redis أو عند تعذر الاتصال
      //    fire-and-forget مع تسجيل الأخطاء — يعمل على process واحد فقط
      logger.warn("BullMQ unavailable — falling back to fire-and-forget for job", { jobId });
      void Promise.resolve()
        .then(() => processImportJob(jobId, session.username))
        .catch((err: unknown) => {
          logger.error("Import job uncaught error (fallback)", { jobId, error: String(err) });
        });
    }

    return NextResponse.json({ accepted: true, jobId, queued, mode: queued ? "queue" : "fallback" }, { status: 202 });
  } catch (error) {
    logger.error("Failed to start import job", { jobId, error: String(error) });
    return NextResponse.json({ error: "تعذر بدء مهمة الاستيراد." }, { status: 500 });
  }
}