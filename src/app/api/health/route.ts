import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";

/**
 * GET /api/health
 * نقطة فحص صحة الخدمة — تُستخدم من قِبل load balancers وأدوات المراقبة.
 * محمية بمعدّل طلبات لمنع DoS.
 */
export async function GET(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const rateLimitError = await checkRateLimit(`health:${ip}`, "api");
  if (rateLimitError) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  try {
    await prisma.$queryRaw`SELECT 1`;

    return NextResponse.json(
      { status: "ok", timestamp: new Date().toISOString() },
      { status: 200 }
    );
  } catch (error) {
    console.error("[api/health]", error);
    return NextResponse.json(
      { status: "error", timestamp: new Date().toISOString() },
      { status: 503 }
    );
  }
}
