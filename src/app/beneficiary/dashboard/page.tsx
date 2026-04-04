import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { getBeneficiarySession } from "@/lib/beneficiary-auth";
import { getLedgerRemainingByBeneficiaryId } from "@/lib/ledger-balance";
import { BeneficiaryDashboardClient } from "./client";

export default async function BeneficiaryDashboardPage() {
  const session = await getBeneficiarySession();
  if (!session) redirect("/beneficiary/login");

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
      transactions: {
        where: { is_cancelled: false, type: { not: "CANCELLATION" } },
        orderBy: { created_at: "desc" },
        take: 30,
        select: {
          id: true,
          amount: true,
          type: true,
          created_at: true,
          facility: { select: { name: true } },
        },
      },
      notifications: {
        orderBy: { created_at: "desc" },
        take: 20,
        select: { id: true, title: true, message: true, amount: true, is_read: true, created_at: true },
      },
    },
  });

  if (!beneficiary) redirect("/beneficiary/login");

  const totalBalance = Number(beneficiary.total_balance);
  const remainingBalance = await getLedgerRemainingByBeneficiaryId(beneficiary.id, totalBalance);

  const data = {
    id: beneficiary.id,
    name: beneficiary.name,
    card_number: beneficiary.card_number,
    birth_date: beneficiary.birth_date?.toISOString() ?? null,
    total_balance: totalBalance,
    remaining_balance: remainingBalance,
    status: beneficiary.status,
    transactions: beneficiary.transactions.map((t) => ({
      id: t.id,
      amount: Number(t.amount),
      type: t.type,
      created_at: t.created_at.toISOString(),
      facility_name: t.facility.name,
    })),
    notifications: beneficiary.notifications.map((n) => ({
      id: n.id,
      title: n.title,
      message: n.message,
      amount: n.amount ? Number(n.amount) : null,
      is_read: n.is_read,
      created_at: n.created_at.toISOString(),
    })),
  };

  return <BeneficiaryDashboardClient initialData={data} />;
}
