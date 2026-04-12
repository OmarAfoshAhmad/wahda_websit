import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Shell } from "@/components/shell";
import { ImportUploader } from "@/components/import-uploader";
import { Badge } from "@/components/ui";
import { getCurrentInitialBalance } from "@/lib/initial-balance";
import { hasPermission } from "@/lib/session-guard";

export default async function ImportPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  if (!hasPermission(session, "import_beneficiaries")) {
    redirect("/dashboard");
  }

  const initialBalance = await getCurrentInitialBalance();

  return (
    <Shell facilityName={session.name} session={session}>
      <div className="space-y-5">
        <div className="mb-8 text-center">
          <Badge className="mb-4">للمبرمج فقط</Badge>
          <h1 className="section-title text-2xl font-black text-slate-950 dark:text-white sm:text-3xl">استيراد بيانات المستفيدين</h1>
          <p className="mx-auto mt-2 max-w-2xl text-sm leading-7 text-slate-600 dark:text-slate-300 sm:text-base">
            ارفع ملف Excel لإضافة المستفيدين دفعة واحدة. سيتم إنشاء رصيد ابتدائي بقيمة {initialBalance.toLocaleString("ar-LY")} د.ل لكل سجل جديد.
          </p>
        </div>

        <ImportUploader />
      </div>
    </Shell>
  );
}
