import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, Store } from "lucide-react";
import { Shell } from "@/components/shell";
import { getSessionWithFreshPermissions, hasPermission } from "@/lib/session-guard";
import { getMyPharmacyProfile } from "@/app/actions/pharmacy-orders";
import { MyPharmacyForm } from "./my-pharmacy-form";

export default async function MyPharmacyPage() {
  const session = await getSessionWithFreshPermissions();
  if (!session) redirect("/login");
  if (!hasPermission(session, "pharmacy_services")) redirect("/admin/pharmacy-services");
  const result = await getMyPharmacyProfile();

  return (
    <Shell facilityName={session.name} session={session}>
      <div className="mx-auto max-w-3xl space-y-5 pb-12">
        <div className="flex flex-col gap-3 border-b border-slate-200 pb-4 dark:border-slate-800">
          <Link href="/admin/pharmacy-services" className="inline-flex w-fit items-center gap-1 text-sm font-bold text-slate-500 hover:text-teal-700">
            <ArrowRight className="h-4 w-4" /> خدمات الصيدلية
          </Link>
          <h1 className="flex items-center gap-2 text-2xl font-black text-slate-900 dark:text-white"><Store className="h-6 w-6 text-teal-600" /> بيانات صيدليتي</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">تظهر هذه البيانات للمستفيدين في بوابتهم لاختيار الصيدلية وطلب الأدوية. قيمة التوصيل خارج التأمين ويدفعها المستفيد.</p>
        </div>
        <MyPharmacyForm facilityName={"facilityName" in result ? result.facilityName ?? "" : ""} initial={"profile" in result ? result.profile ?? null : null} />
      </div>
    </Shell>
  );
}
