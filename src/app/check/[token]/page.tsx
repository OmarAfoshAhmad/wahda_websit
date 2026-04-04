import { notFound } from "next/navigation";
import prisma from "@/lib/prisma";
import { verifyBeneficiaryToken } from "@/lib/beneficiary-token";
import { getLedgerRemainingByBeneficiaryId } from "@/lib/ledger-balance";
import { Wallet, CalendarDays, ShieldX } from "lucide-react";

const TYPE_LABELS: Record<string, string> = {
  MEDICINE:     "دواء",
  SUPPLIES:     "مستلزمات",
  CANCELLATION: "إلغاء",
  IMPORT:       "رصيد مستخدم",
};

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  ACTIVE:    { label: "نشط",    color: "bg-emerald-100 text-emerald-700" },
  FINISHED:  { label: "مكتمل", color: "bg-slate-100 text-slate-600" },
  SUSPENDED: { label: "موقوف", color: "bg-amber-100 text-amber-700" },
};

export default async function CheckTokenPage({
  params,
}: {
  params: { token: string };
}) {
  const { token } = await params;
  const beneficiaryId = verifyBeneficiaryToken(decodeURIComponent(token));

  // رابط غير صالح أو مزوّر
  if (!beneficiaryId) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-50 px-4 text-center" dir="rtl">
        <ShieldX className="h-12 w-12 text-red-400" />
        <h1 className="text-xl font-black text-slate-800">رابط غير صالح</h1>
        <p className="text-sm text-slate-500">
          هذا الرابط غير صحيح. تواصل مع شركة الواحة للحصول على رابطك الخاص.
        </p>
      </div>
    );
  }

  const beneficiary = await prisma.beneficiary.findFirst({
    where: { id: beneficiaryId, deleted_at: null },
    select: {
      name: true,
      card_number: true,
      birth_date: true,
      total_balance: true,
      remaining_balance: true,
      status: true,
      transactions: {
        where: { is_cancelled: false, type: { not: "CANCELLATION" } },
        orderBy: { created_at: "desc" },
        take: 100,
        select: {
          id: true,
          amount: true,
          type: true,
          created_at: true,
          facility: { select: { name: true } },
        },
      },
    },
  });

  if (!beneficiary) notFound();

  const totalBalance     = Number(beneficiary.total_balance);
  const remainingBalance = await getLedgerRemainingByBeneficiaryId(beneficiaryId, totalBalance);
  const usedBalance      = totalBalance - remainingBalance;
  const statusInfo       = STATUS_MAP[beneficiary.status] ?? STATUS_MAP.ACTIVE;

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8" dir="rtl">
      <div className="mx-auto max-w-xl space-y-5">

        <div className="text-center">
          <p className="text-xs font-bold uppercase tracking-widest text-slate-400">
            شركة الواحة للرعاية الصحية
          </p>
        </div>

        {/* بيانات المستفيد */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-xl font-black text-slate-900">{beneficiary.name}</h2>
              <p className="mt-0.5 font-mono text-sm text-slate-500">{beneficiary.card_number}</p>
              {beneficiary.birth_date && (
                <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-400">
                  <CalendarDays className="h-3.5 w-3.5" />
                  {new Date(beneficiary.birth_date).toLocaleDateString("ar-LY")}
                </p>
              )}
            </div>
            <span className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-xs font-bold ${statusInfo.color}`}>
              {statusInfo.label}
            </span>
          </div>

          {/* الرصيد */}
          <div className="mt-5 grid grid-cols-3 divide-x divide-x-reverse divide-slate-100 rounded-lg border border-slate-100 bg-slate-50 text-center">
            <div className="px-3 py-3">
              <p className="text-xs font-bold text-slate-400">الرصيد الكلي</p>
              <p className="mt-1 text-lg font-black text-slate-800">{totalBalance.toLocaleString("ar-LY")}</p>
              <p className="text-[11px] text-slate-400">د.ل</p>
            </div>
            <div className="px-3 py-3">
              <p className="text-xs font-bold text-slate-400">المستخدم</p>
              <p className="mt-1 text-lg font-black text-red-600">{usedBalance.toLocaleString("ar-LY")}</p>
              <p className="text-[11px] text-slate-400">د.ل</p>
            </div>
            <div className="px-3 py-3">
              <p className="text-xs font-bold text-slate-400">المتبقي</p>
              <p className="mt-1 text-lg font-black text-emerald-600">{remainingBalance.toLocaleString("ar-LY")}</p>
              <p className="text-[11px] text-slate-400">د.ل</p>
            </div>
          </div>
        </div>

        {/* الحركات */}
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-3.5">
            <Wallet className="h-4 w-4 text-slate-400" />
            <h3 className="font-black text-slate-800">سجل الحركات</h3>
            <span className="mr-auto rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-500">
              {beneficiary.transactions.length}
            </span>
          </div>

          {beneficiary.transactions.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-slate-400">لا توجد حركات مسجلة.</p>
          ) : (
            <ul className="divide-y divide-slate-50">
              {beneficiary.transactions.map((tx) => (
                <li key={tx.id} className="flex items-center justify-between px-5 py-3.5">
                  <div>
                    <p className="text-sm font-bold text-slate-800">
                      {TYPE_LABELS[tx.type] ?? tx.type}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-400">
                      {tx.facility.name} · {new Date(tx.created_at).toLocaleDateString("ar-LY")}
                    </p>
                  </div>
                  <span className="font-black text-red-600">
                    -{Number(tx.amount).toLocaleString("ar-LY")} د.ل
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

      </div>
    </div>
  );
}

