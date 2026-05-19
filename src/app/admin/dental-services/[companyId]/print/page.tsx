import { redirect } from "next/navigation";
import { notFound } from "next/navigation";
import prisma from "@/lib/prisma";
import { getSessionWithFreshPermissions } from "@/lib/session-guard";
import { formatDateTripoli, formatTimeTripoli } from "@/lib/datetime";
import { BackButton } from "@/components/back-button";
import { AutoPrint } from "@/components/auto-print";

export default async function DentalCompanyPrintPage({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const session = await getSessionWithFreshPermissions();
  if (!session) redirect("/login");
  if (!session.is_admin && !session.is_manager) redirect("/dashboard");

  const { companyId } = await params;

  // جلب بيانات الشركة
  const company = await prisma.insuranceCompany.findUnique({
    where: { id: companyId, deleted_at: null, is_active: true },
  });

  if (!company) notFound();

  // جلب جميع حركات الأسنان غير الملغاة لهذه الشركة في هذا المرفق
  const transactions = await prisma.transaction.findMany({
    where: {
      company_id: companyId,
      facility_id: session.id,
      type: "DENTAL",
      is_cancelled: false,
    },
    include: {
      beneficiary: {
        select: {
          name: true,
          card_number: true,
        },
      },
    },
    orderBy: {
      created_at: "desc",
    },
    take: 2000, // سقف منطقي لورقة الكشف المطبوعة
  });

  // حساب الإجماليات
  const totalCount = transactions.length;
  const totalAmount = transactions.reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
  const totalCompanyShare = transactions.reduce((sum, tx) => sum + Number(tx.actual_company_share || 0), 0);
  const totalPatientShare = transactions.reduce((sum, tx) => sum + Number(tx.actual_patient_share || 0), 0);

  return (
    <div dir="rtl" style={{ backgroundColor: "#fff", color: "#000", margin: "0", padding: "0" }} className="min-h-screen p-8">
      <style dangerouslySetInnerHTML={{ __html: `
        @media print {
          @page { 
            size: A4 landscape; 
            margin: 1.2cm;
          }
          html, body { 
            background: white !important; 
            color: black !important;
          }
          .no-print { display: none !important; }
          .print-container { width: 100% !important; margin: 0 !important; padding: 0 !important; }
        }
      ` }} />

      <div id="printable-report" className="print-container max-w-6xl mx-auto space-y-6">
        {/* الترويسة الفخمة */}
        <div className="flex items-center justify-between border-b-4 border-teal-600 pb-4">
          <div className="space-y-1">
            <h1 className="text-2xl font-black tracking-tight text-slate-900">Waha Health Care</h1>
            <p className="text-xs text-slate-500 font-bold">منظومة إدارة مطالبات التأمين الطبي</p>
          </div>
          <div className="text-center">
            <h2 className="text-xl font-black text-teal-800">كشف حركات الأسنان المخصصة</h2>
            <p className="text-xs font-bold text-slate-500 mt-1">شركة التأمين: {company.name}</p>
          </div>
          <div className="text-left space-y-1 text-xs">
            <p className="font-bold text-slate-800">المرفق: <span className="font-black text-teal-700">{session.name}</span></p>
            <p className="text-slate-500 font-bold">تاريخ الطباعة: {formatDateTripoli(new Date())}</p>
          </div>
        </div>

        {/* صناديق الإحصائيات المجمعة */}
        <div className="grid grid-cols-4 gap-4 text-center">
          <div className="border border-slate-300 rounded-lg p-3 bg-slate-50">
            <p className="text-[10px] font-bold text-slate-500 uppercase">إجمالي العمليات</p>
            <p className="text-lg font-black text-slate-900 mt-1">{totalCount.toLocaleString("ar-LY")}</p>
          </div>
          <div className="border border-slate-300 rounded-lg p-3 bg-slate-50">
            <p className="text-[10px] font-bold text-slate-500 uppercase">إجمالي الفواتير</p>
            <p className="text-lg font-black text-slate-900 mt-1">{totalAmount.toLocaleString("ar-LY", { minimumFractionDigits: 2 })} د.ل</p>
          </div>
          <div className="border border-slate-300 rounded-lg p-3 bg-teal-50/50 border-teal-200">
            <p className="text-[10px] font-bold text-teal-600 uppercase">مستحق على الشركة</p>
            <p className="text-lg font-black text-teal-800 mt-1">{totalCompanyShare.toLocaleString("ar-LY", { minimumFractionDigits: 2 })} د.ل</p>
          </div>
          <div className="border border-slate-300 rounded-lg p-3 bg-amber-50/50 border-amber-200">
            <p className="text-[10px] font-bold text-amber-600 uppercase">مدفوع كاش (مؤمن)</p>
            <p className="text-lg font-black text-amber-800 mt-1">{totalPatientShare.toLocaleString("ar-LY", { minimumFractionDigits: 2 })} د.ل</p>
          </div>
        </div>

        {/* الجدول الرئيسي المنسق للطباعة */}
        <table className="w-full text-right border-collapse text-xs border border-slate-400">
          <thead>
            <tr className="bg-slate-100 border-b border-slate-400 text-slate-800">
              <th className="border border-slate-400 px-3 py-2 text-center font-black w-10">#</th>
              <th className="border border-slate-400 px-3 py-2 font-black">اسم المستفيد</th>
              <th className="border border-slate-400 px-3 py-2 font-black">رقم البطاقة</th>
              <th className="border border-slate-400 px-3 py-2 text-center font-black">قيمة الفاتورة</th>
              <th className="border border-slate-400 px-3 py-2 text-center font-black">حصة الشركة</th>
              <th className="border border-slate-400 px-3 py-2 text-center font-black">حصة المؤمن (كاش)</th>
              <th className="border border-slate-400 px-3 py-2 font-black">تاريخ ووقت الحركة</th>
            </tr>
          </thead>
          <tbody>
            {transactions.length === 0 ? (
              <tr>
                <td colSpan={7} className="border border-slate-400 px-3 py-8 text-center text-slate-500 font-bold">
                  لا توجد حركات أسنان مسجلة لهذه الشركة في هذا المرفق.
                </td>
              </tr>
            ) : (
              transactions.map((tx, idx) => {
                const amount = Number(tx.amount || 0);
                const companyShare = tx.actual_company_share !== null ? Number(tx.actual_company_share) : 0;
                const patientShare = tx.actual_patient_share !== null ? Number(tx.actual_patient_share) : 0;

                return (
                  <tr key={tx.id} className="border-b border-slate-300 hover:bg-slate-50">
                    <td className="border border-slate-300 px-3 py-2 text-center font-bold text-slate-700">{idx + 1}</td>
                    <td className="border border-slate-300 px-3 py-2 font-black text-slate-900">{tx.beneficiary?.name || "—"}</td>
                    <td className="border border-slate-300 px-3 py-2 font-mono font-bold text-slate-700">{tx.beneficiary?.card_number || "—"}</td>
                    <td className="border border-slate-300 px-3 py-2 text-center font-mono font-black">{amount.toLocaleString("ar-LY", { minimumFractionDigits: 2 })} د.ل</td>
                    <td className="border border-slate-300 px-3 py-2 text-center font-mono font-black text-teal-800">{companyShare.toLocaleString("ar-LY", { minimumFractionDigits: 2 })} د.ل</td>
                    <td className="border border-slate-300 px-3 py-2 text-center font-mono font-black text-amber-700">{patientShare.toLocaleString("ar-LY", { minimumFractionDigits: 2 })} د.ل</td>
                    <td className="border border-slate-300 px-3 py-2 font-bold text-slate-700">
                      {formatDateTripoli(tx.created_at)} <span className="text-slate-400 mr-1.5">{formatTimeTripoli(tx.created_at)}</span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>

        {/* حقل التوقيع والتأكيد السفلي المخصص للمالية والمراجعة */}
        <div className="pt-12 grid grid-cols-3 gap-8 text-center text-xs font-bold text-slate-700">
          <div className="space-y-8">
            <p>توقيع مسؤول المرفق</p>
            <p className="text-slate-400">___________________</p>
          </div>
          <div className="space-y-8">
            <p>الختم الرسمي للمرفق</p>
            <p className="text-slate-400">___________________</p>
          </div>
          <div className="space-y-8">
            <p>مراجعة إدارة شؤون التأمين</p>
            <p className="text-slate-400">___________________</p>
          </div>
        </div>

        {/* المكون السحري للطباعة التلقائية مع تأخير بسيط لضمان اكتمال التحميل */}
        <AutoPrint delay={1200} />

        {/* زر العودة للمنظومة يختفي عند الطباعة */}
        <div className="no-print pt-6 flex justify-center">
          <BackButton />
        </div>
      </div>
    </div>
  );
}
