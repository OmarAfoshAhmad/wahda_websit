import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    {
      error: "تم نقل الاستعادة إلى النظام الخلفي الجديد. استخدم /api/backup/restore-jobs",
    },
    { status: 410 }
  );
}
