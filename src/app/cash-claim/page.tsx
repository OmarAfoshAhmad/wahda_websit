import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Shell } from "@/components/shell";
import { hasPermission } from "@/lib/session-guard";
import { CashClaimForm } from "@/components/cash-claim-form";
import prisma from "@/lib/prisma";

export default async function CashClaimPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  if (!hasPermission(session, "cash_claim")) {
    redirect("/dashboard");
  }

  // جلب قائمة المرافق (للمشرف والمدير فقط)
  const facilities =
    session.is_admin || session.is_manager
      ? await prisma.facility.findMany({
          where: { deleted_at: null, is_admin: false },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        })
      : [];

  return (
    <Shell facilityName={session.name} session={session}>
      <div className="space-y-5">
        <div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white">كاش — توزيع فاتورة عائلية</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            ابحث عن مستفيد لعرض أفراد عائلته وتوزيع مبلغ الفاتورة عليهم
          </p>
        </div>
        <CashClaimForm
          facilities={facilities}
          showFacilityPicker={session.is_admin || session.is_manager}
        />
      </div>
    </Shell>
  );
}
