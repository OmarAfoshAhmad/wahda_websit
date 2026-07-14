import { NextRequest, NextResponse } from "next/server";
import { requireActiveFacilitySession } from "@/lib/session-guard";
import { createBeneficiaryToken } from "@/lib/beneficiary-token";

export async function GET(request: NextRequest) {
  const session = await requireActiveFacilitySession();
  if (!session || !session.is_admin) {
    return NextResponse.json({ error: "غير مصرح" }, { status: 403 });
  }

  const id = request.nextUrl.searchParams.get("id")?.trim();
  if (!id) return NextResponse.json({ error: "id مطلوب" }, { status: 400 });

  const token = createBeneficiaryToken(id);
  const origin = request.nextUrl.origin;
  const url = `${origin}/check/${encodeURIComponent(token)}`;

  return NextResponse.json({ url });
}
