import { NextResponse } from "next/server";
import { requireActiveFacilitySession } from "@/lib/session-guard";
import { getWahdaAllocationWindowEnabled } from "@/lib/system-settings";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireActiveFacilitySession();
  if (!session) return NextResponse.json({ error: "غير مصرح" }, { status: 401 });

  return NextResponse.json(
    { wahdaAllocationWindowEnabled: await getWahdaAllocationWindowEnabled() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
