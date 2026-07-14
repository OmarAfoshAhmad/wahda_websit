import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getBeneficiarySessionFromRequest } from "@/lib/beneficiary-auth";
import { getLedgerRemainingByBeneficiaryId } from "@/lib/ledger-balance";

export async function GET(req: NextRequest) {
  const session = await getBeneficiarySessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "غير مصرح" }, { status: 401 });

  const beneficiary = await prisma.beneficiary.findFirst({
    where: { id: session.id, deleted_at: null },
    select: {
      id: true,
      name: true,
      card_number: true,
      birth_date: true,
      total_balance: true,
      remaining_balance: true,
      status: true,
      notifications: {
        where: { is_read: false },
        select: { id: true },
      },
    },
  });

  if (!beneficiary) return NextResponse.json({ error: "غير موجود" }, { status: 404 });

  const totalBalance = Number(beneficiary.total_balance);
  const remainingBalance = await getLedgerRemainingByBeneficiaryId(beneficiary.id, totalBalance);

  return NextResponse.json({
    ...beneficiary,
    total_balance: totalBalance,
    remaining_balance: remainingBalance,
    unread_count: beneficiary.notifications.length,
    notifications: undefined,
  });
}
