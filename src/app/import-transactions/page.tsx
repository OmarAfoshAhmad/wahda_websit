import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Shell } from "@/components/shell";
import { TransactionImportUploader } from "@/components/transaction-import-uploader";
import { Badge } from "@/components/ui";
import prisma from "@/lib/prisma";

export default async function ImportTransactionsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.is_admin) redirect("/dashboard");

  const facilities = await prisma.facility.findMany({
    where: { deleted_at: null },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  const companyFacilityId = process.env.WAAD_FACILITY_ID;
  const defaultFacilityId = facilities.find((f) => f.id === companyFacilityId)?.id ?? session.id;

  return (
    <Shell facilityName={session.name} isAdmin={session.is_admin}>
      <div className="space-y-5">
        <div className="mb-8 text-center">
          <Badge className="mb-4">للمشرف فقط</Badge>
          <h1 className="section-title text-2xl font-black text-slate-950 sm:text-3xl">استيراد الحركات المجمعة</h1>
          <p className="mx-auto mt-2 max-w-2xl text-sm leading-7 text-slate-600 sm:text-base">
            ارفع ملف Excel للمنطقة لاستيراد حركات الخصم. يتم توزيع المبلغ المستخدم بالتساوي على كل أفراد الأسرة.
            الأسر الغير موجودة لن تُستورد وستظهر في تقرير منفصل.
          </p>
        </div>

        <TransactionImportUploader facilities={facilities} defaultFacilityId={defaultFacilityId} />
      </div>
    </Shell>
  );
}
