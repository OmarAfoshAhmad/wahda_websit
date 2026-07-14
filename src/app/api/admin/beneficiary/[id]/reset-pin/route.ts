import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireActiveFacilitySession } from "@/lib/session-guard";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireActiveFacilitySession();
  if (!session?.is_admin) {
    return NextResponse.json({ error: "غير مصرح" }, { status: 403 });
  }

  const { id } = await params;

  const beneficiary = await prisma.beneficiary.findFirst({
    where: { id, deleted_at: null },
    select: { id: true },
  });

  if (!beneficiary) {
    return NextResponse.json({ error: "المستفيد غير موجود" }, { status: 404 });
  }

  await prisma.beneficiary.update({
    where: { id },
    data: { pin_hash: null, failed_attempts: 0, locked_until: null },
  });

  await prisma.auditLog.create({
    data: {
      facility_id: session.id,
      user: session.username,
      action: "RESET_BENEFICIARY_PIN",
      metadata: { beneficiary_id: id },
    },
  });

  return NextResponse.json({ ok: true });
}
