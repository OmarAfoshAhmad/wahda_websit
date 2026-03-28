import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { processImportJob } from "@/lib/import-jobs";
import { enqueueImportJob } from "@/lib/queue";
import { logger } from "@/lib/logger";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!session.is_admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { jobId } = await params;

  // 1. حاول إضافة المهمة للطابور الموثوق (BullMQ + Redis)
  const queued = await enqueueImportJob(jobId, session.username);

  if (!queued) {
    // 2. Fallback للبيئات بدون Redis (مثل بيئة التطوير)
    //    fire-and-forget مع تسجيل الأخطاء — يعمل على process واحد فقط
    logger.warn("BullMQ unavailable — falling back to fire-and-forget for job", { jobId });
    void Promise.resolve()
      .then(() => processImportJob(jobId, session.username))
      .catch((err: unknown) => {
        logger.error("Import job uncaught error (fallback)", { jobId, error: String(err) });
      });
  }

  return NextResponse.json({ accepted: true, jobId, queued }, { status: 202 });
}