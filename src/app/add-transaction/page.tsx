import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { canAccessAdmin } from "@/lib/session-guard";
import { Shell } from "@/components/shell";
import { AddTransactionForm } from "@/components/add-transaction-form";
import prisma from "@/lib/prisma";

export default async function AddTransactionPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!canAccessAdmin(session)) redirect("/dashboard");

  const facilities = await prisma.facility.findMany({
    where: { deleted_at: null },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  return (
    <Shell facilityName={session.name} session={session}>
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white">إضافة حركة يدوية</h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            نافذة إضافة حركة مباشرة على المنظومة مع التحقق من الرصيد وتسجيل العملية في السجل.
          </p>
        </div>

        <AddTransactionForm
          facilities={facilities}
          defaultFacilityId={session.id}
          canChooseFacility={session.is_admin}
        />
      </div>
    </Shell>
  );
}
