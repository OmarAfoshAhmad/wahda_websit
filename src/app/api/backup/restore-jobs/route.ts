import { NextRequest, NextResponse } from "next/server";
import { requireActiveFacilitySession } from "@/lib/session-guard";
import {
  createRestoreJob,
  resumeLatestRestoreJobIfNeeded,
  startRestoreJobInBackground,
} from "@/lib/restore-jobs";

const MAX_BACKUP_SIZE = 100 * 1024 * 1024; // 100 MB

export async function POST(request: NextRequest) {
  const session = await requireActiveFacilitySession();
  if (!session || !session.is_admin) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const forwardedProto = request.headers.get("x-forwarded-proto");
  if (process.env.NODE_ENV === "production" && forwardedProto && forwardedProto !== "https") {
    return NextResponse.json({ error: "يجب استخدام HTTPS" }, { status: 400 });
  }

  const contentLength = request.headers.get("content-length");
  if (contentLength && parseInt(contentLength, 10) > MAX_BACKUP_SIZE) {
    return NextResponse.json({ error: "حجم الملف كبير جداً (الحد الأقصى 100MB)" }, { status: 413 });
  }

  const payload = Buffer.from(await request.arrayBuffer());
  if (payload.length === 0) {
    return NextResponse.json({ error: "ملف النسخة الاحتياطية فارغ" }, { status: 400 });
  }
  if (payload.length > MAX_BACKUP_SIZE) {
    return NextResponse.json({ error: "حجم الملف كبير جداً (الحد الأقصى 100MB)" }, { status: 413 });
  }

  const created = await createRestoreJob({
    username: session.username,
    payload,
  });

  if ("error" in created) {
    return NextResponse.json({ error: created.error }, { status: 409 });
  }

  await startRestoreJobInBackground(created.job.id, session.username);

  return NextResponse.json({ accepted: true, job: created.job }, { status: 202 });
}

export async function GET() {
  const session = await requireActiveFacilitySession();
  if (!session || !session.is_admin) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const job = await resumeLatestRestoreJobIfNeeded(session.username);
  return NextResponse.json({ job });
}
