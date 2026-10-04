import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, MessagesSquare } from "lucide-react";
import { Shell } from "@/components/shell";
import { getSessionWithFreshPermissions, hasPermission } from "@/lib/session-guard";
import { OrdersInbox } from "./orders-inbox";

export default async function PharmacyOrdersPage() {
  const session = await getSessionWithFreshPermissions();
  if (!session) redirect("/login");
  if (!hasPermission(session, "pharmacy_services")) redirect("/admin/pharmacy-services");

  return (
    <Shell facilityName={session.name} session={session}>
      <div className="space-y-4 pb-6">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3 dark:border-slate-800">
          <h1 className="flex items-center gap-2 text-2xl font-black text-slate-900 dark:text-white"><MessagesSquare className="h-6 w-6 text-teal-600" /> طلبات المستفيدين</h1>
          <Link href="/admin/pharmacy-services" className="inline-flex items-center gap-1 text-sm font-bold text-slate-500 hover:text-teal-700"><ArrowRight className="h-4 w-4" /> خدمات الصيدلية</Link>
        </div>
        <OrdersInbox />
      </div>
    </Shell>
  );
}
