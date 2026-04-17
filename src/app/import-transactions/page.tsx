import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Shell } from "@/components/shell";
import { TransactionImportUploader } from "@/components/transaction-import-uploader";
import { Badge } from "@/components/ui";

export default async function ImportTransactionsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.is_admin) redirect("/dashboard");

  return (
    <Shell facilityName={session.name} session={session}>
      <div className="space-y-5">
        <div className="mb-8 text-center">
          <Badge className="mb-4">للمبرمج فقط</Badge>
          <h1 className="section-title text-2xl font-black text-slate-950 dark:text-white sm:text-3xl">استيراد الحركات المجمعة</h1>
          <p className="mx-auto mt-2 max-w-2xl text-sm leading-7 text-slate-600 dark:text-slate-400 sm:text-base">
            ارفع ملف Excel للمنطقة لاستيراد حركات الخصم. يتم توزيع المبلغ المستخدم بالتساوي على كل أفراد الأسرة.
            الأسر الغير موجودة لن تُستورد وستظهر في تقرير منفصل.
          </p>
        </div>

        <TransactionImportUploader currentActorName={session.name} />
      </div>
    </Shell>
  );
}
