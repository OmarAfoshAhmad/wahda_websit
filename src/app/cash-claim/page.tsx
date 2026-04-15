import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Shell } from "@/components/shell";
import { CashClaimForm } from "@/components/cash-claim-form";

export default async function CashClaimPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  if (!session.is_employee) {
    redirect("/dashboard");
  }

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
          facilities={[]}
          showFacilityPicker={false}
        />
      </div>
    </Shell>
  );
}
