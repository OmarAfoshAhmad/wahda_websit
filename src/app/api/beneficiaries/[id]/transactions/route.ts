import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireActiveFacilitySession, hasPermission } from "@/lib/session-guard";

function extractFamilyBaseCard(cardNumber: string): string {
  const normalized = String(cardNumber ?? "").trim().toUpperCase();
  const match = normalized.match(/^(.*?)([WSDMFHV])(\d+)$/i);
  return match ? match[1] : normalized;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireActiveFacilitySession();
  if (!session || !hasPermission(session, "view_beneficiaries")) {
    return NextResponse.json({ error: "غير مصرح" }, { status: 403 });
  }

  const { id } = await params;
  const beneficiaryId = String(id ?? "").trim();
  if (!beneficiaryId) {
    return NextResponse.json({ error: "معرف غير صالح" }, { status: 400 });
  }

  const beneficiary = await prisma.beneficiary.findFirst({
    where: { id: beneficiaryId },
    select: {
      id: true,
      name: true,
      card_number: true,
      total_balance: true,
      remaining_balance: true,
      status: true,
      deleted_at: true,
    },
  });

  if (!beneficiary) {
    return NextResponse.json({ error: "المستفيد غير موجود" }, { status: 404 });
  }

  const familyBaseCard = extractFamilyBaseCard(beneficiary.card_number);
  const familyCandidates = await prisma.beneficiary.findMany({
    where: {
      deleted_at: null,
      card_number: { startsWith: familyBaseCard, mode: "insensitive" },
    },
    select: {
      id: true,
      name: true,
      card_number: true,
      status: true,
      remaining_balance: true,
    },
    orderBy: [{ card_number: "asc" }, { created_at: "asc" }],
    take: 250,
  });

  const familyMembers = familyCandidates
    .filter((m) => extractFamilyBaseCard(m.card_number) === familyBaseCard)
    .map((m) => ({
      id: m.id,
      name: m.name,
      card_number: m.card_number,
      status: m.status,
      remaining_balance: Number(m.remaining_balance),
      is_selected: m.id === beneficiary.id,
    }));

  const transactions = await prisma.transaction.findMany({
    where: { beneficiary_id: beneficiaryId },
    orderBy: [{ created_at: "desc" }, { id: "desc" }],
    take: 500,
    select: {
      id: true,
      amount: true,
      type: true,
      is_cancelled: true,
      created_at: true,
      facility: { select: { name: true } },
      original_transaction_id: true,
    },
  });

  const activeTx = transactions.filter((t) => !t.is_cancelled);
  const totalUsed = activeTx
    .filter((t) => t.type !== "CANCELLATION")
    .reduce((sum, t) => sum + Number(t.amount), 0);

  return NextResponse.json({
    item: {
      beneficiary: {
        id: beneficiary.id,
        name: beneficiary.name,
        card_number: beneficiary.card_number,
        total_balance: Number(beneficiary.total_balance),
        remaining_balance: Number(beneficiary.remaining_balance),
        status: beneficiary.status,
        deleted_at: beneficiary.deleted_at,
      },
      family: {
        base_card: familyBaseCard,
        members_count: familyMembers.length,
        members: familyMembers,
      },
      summary: {
        transactions_count: transactions.length,
        active_transactions_count: activeTx.length,
        cancelled_transactions_count: transactions.length - activeTx.length,
        total_used: Math.round(totalUsed * 100) / 100,
      },
      transactions: transactions.map((t) => ({
        id: t.id,
        amount: Number(t.amount),
        type: t.type,
        is_cancelled: t.is_cancelled,
        created_at: t.created_at,
        facility_name: t.facility?.name ?? "-",
        original_transaction_id: t.original_transaction_id,
      })),
    },
  });
}
