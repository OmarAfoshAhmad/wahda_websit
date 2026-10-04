import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { getBeneficiarySession } from "@/lib/beneficiary-auth";
import { getLedgerRemainingByBeneficiaryId } from "@/lib/ledger-balance";
import { getChronicDrugStatuses, getPharmacyUsage } from "@/lib/pharmacy/summary";
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
      company_id: true,
      pharmacy_dispenses: {
        where: { status: "COMPLETED" },
        orderBy: { created_at: "desc" },
        take: 30,
        select: {
          id: true,
          medicine_category: true,
          gross_total: true,
          company_total: true,
          patient_total: true,
          created_at: true,
          facility: { select: { name: true } },
          items: { orderBy: { sequence: "asc" }, select: { sequence: true, price: true, drug: { select: { name: true } } } },
        },
      },
      transactions: {
        where: { is_cancelled: false, type: { notIn: ["CANCELLATION", "SETTLEMENT"] } },
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

  // بيانات الصيدلية: نفس حساب السقوف والأهلية المستخدم في نافذة الصرف.
  const pharmacySummary = beneficiary.company_id ? await getPharmacyUsage(beneficiary.id, beneficiary.company_id) : null;
  const chronicDrugs = pharmacySummary ? await getChronicDrugStatuses(beneficiary.id, pharmacySummary.chronicIntervalDays) : [];

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
    pharmacy: {
      usage: pharmacySummary?.usage?.categories.filter((category) => category.enabled) ?? [],
      chronicIntervalDays: pharmacySummary?.chronicIntervalDays ?? 28,
      chronicDrugs,
      dispenses: beneficiary.pharmacy_dispenses.map((dispense) => ({
        id: dispense.id,
        category: dispense.medicine_category,
        gross_total: Number(dispense.gross_total),
        company_total: Number(dispense.company_total),
        patient_total: Number(dispense.patient_total),
        created_at: dispense.created_at.toISOString(),
        facility_name: dispense.facility.name,
        items: dispense.items.map((item) => ({ sequence: item.sequence, price: Number(item.price), drug_name: item.drug?.name ?? null })),
      })),
    },
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
