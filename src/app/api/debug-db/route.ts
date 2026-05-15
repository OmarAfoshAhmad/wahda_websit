import { NextResponse, NextRequest } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q") || "";
  
  const beneficiaries = await prisma.beneficiary.findMany({
    where: {
      card_number: {
        contains: q,
        mode: 'insensitive'
      }
    },
    take: 10,
    select: { card_number: true, name: true, deleted_at: true, phone_number: true }
  });
  
  return NextResponse.json({
    query: q,
    results: beneficiaries
  });
}
