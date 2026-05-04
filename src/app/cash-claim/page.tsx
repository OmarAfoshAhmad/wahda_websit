import { getSessionWithFreshPermissions, hasPermission } from "@/lib/session-guard";
import { redirect } from "next/navigation";
import { Shell } from "@/components/shell";
import { CashClaimForm } from "@/components/cash-claim-form";
import prisma from "@/lib/prisma";
import { ListOrdered } from "lucide-react";
import { Card } from "@/components/ui";
import { formatDateTripoli, formatTimeTripoli } from "@/lib/datetime";
import Link from "next/link";

export default async function CashClaimPage() {
  const session = await getSessionWithFreshPermissions();
  if (!session) redirect("/login");

  const canUseCashClaim = hasPermission(session, "cash_claim");
  const hasAdminNav = hasPermission(session, "view_facilities") || 
                      hasPermission(session, "view_beneficiaries") ||
                      hasPermission(session, "manage_card_numbering");

  if (!session.is_employee || (!canUseCashClaim && !hasAdminNav)) {
    redirect("/dashboard");
  }

  // جلب آخر 10 حركات لهذا الموظف/المرفق
  const recentTransactions = await prisma.transaction.findMany({
    where: { facility_id: session.id, is_cancelled: false },
    take: 10,
    orderBy: { created_at: "desc" },
    include: { beneficiary: { select: { name: true, card_number: true } } },
  });

  return (
    <Shell facilityName={session.name} session={session}>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white">كاش — توزيع فاتورة عائلية</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            ابحث عن مستفيد لعرض أفراد عائلته وتوزيع مبلغ الفاتورة عليهم
          </p>
        </div>
        
        <CashClaimForm
          facilities={[]}
          showFacilityPicker={false}
        />

        {/* قائمة الحركات الأخيرة */}
        <div className="mt-8">
          <h2 className="text-lg font-black text-slate-900 dark:text-white mb-3 flex items-center gap-2">
            <ListOrdered className="h-5 w-5 text-primary" />
            آخر حركات الخصم المنفذة
          </h2>
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-800/70 text-slate-700 dark:text-slate-200 text-right">
                  <tr>
                    <th className="px-4 py-2">المستفيد</th>
                    <th className="px-4 py-2">رقم البطاقة</th>
                    <th className="px-4 py-2">المبلغ</th>
                    <th className="px-4 py-2">الوقت</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-right">
                  {recentTransactions.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-8 text-center text-slate-500 dark:text-slate-400">
                        لا توجد حركات سابقة مسجلة.
                      </td>
                    </tr>
                  ) : (
                    recentTransactions.map((tx) => (
                      <tr key={tx.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                        <td className="px-4 py-2 font-bold text-slate-900 dark:text-slate-100">{tx.beneficiary.name}</td>
                        <td className="px-4 py-2 text-slate-600 dark:text-slate-300 font-mono">{tx.beneficiary.card_number}</td>
                        <td suppressHydrationWarning className="px-4 py-2 font-black text-emerald-600 dark:text-emerald-400">
                          {Number(tx.amount).toLocaleString("ar-LY")} د.ل
                        </td>
                        <td suppressHydrationWarning className="px-4 py-2 text-slate-500 dark:text-slate-400">
                          {formatDateTripoli(tx.created_at, "en-GB")} {formatTimeTripoli(tx.created_at)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            {recentTransactions.length > 0 && (
              <div className="bg-slate-50 dark:bg-slate-800/50 px-4 py-2 text-left border-t border-slate-100 dark:border-slate-800">
                <Link href="/transactions" className="text-xs font-bold text-primary hover:underline">
                  عرض جميع الحركات ←
                </Link>
              </div>
            )}
          </Card>
        </div>
      </div>
    </Shell>
  );
}
