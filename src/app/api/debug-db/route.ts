import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET() {
  const jobs = await prisma.importJob.findMany({
    orderBy: { created_at: 'desc' },
    take: 3
  });
  return NextResponse.json({ jobs });
}
