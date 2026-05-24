import { redirect } from "next/navigation";
import { notFound } from "next/navigation";
import prisma from "@/lib/prisma";
import { getSessionWithFreshPermissions, hasPermission } from "@/lib/session-guard";
import { formatDateTripoli, formatTimeTripoli } from "@/lib/datetime";
import { BackButton } from "@/components/back-button";
import { AutoPrint } from "@/components/auto-print";

const ROWS_PER_PRINT_PAGE = 30;

export default async function DentalCompanyPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ companyId: string }>;
  searchParams: Promise<{
    q?: string;
    from?: string;
    to?: string;
  }>;
}) {
  const session = await getSessionWithFreshPermissions();
  if (!session) redirect("/login");
  const canAccess = session.is_admin || hasPermission(session, "dental_services");
  if (!canAccess) redirect("/dashboard");


  const { companyId } = await params;
  const sp = await searchParams;
  const searchQuery = (sp.q ?? "").trim();
  const fromDate = sp.from ?? "";
  const toDate = sp.to ?? "";

  // جلب بيانات الشركة
  const company = (await prisma.insuranceCompany.findUnique({
    where: { id: companyId, deleted_at: null, is_active: true },
  })) as any;

  if (!company) notFound();

  const ceiling = company.dental_ceiling ? Number(company.dental_ceiling) : null;
  const dentalCeiling = ceiling ?? 3000;

  // بناء شروط الاستعلام
  const where: any = {
    company_id: companyId,
    type: "DENTAL",
    is_cancelled: false,
    ...(session.is_admin ? {} : { facility_id: session.id }),
  };

  if (searchQuery) {
    where.OR = [
      { beneficiary: { name: { contains: searchQuery, mode: "insensitive" } } },
      { beneficiary: { card_number: { contains: searchQuery, mode: "insensitive" } } },
    ];
  }

  if (fromDate) {
    const from = new Date(fromDate);
    from.setHours(0, 0, 0, 0);
    where.created_at = { ...(where.created_at as object ?? {}), gte: from };
  }
  if (toDate) {
    const to = new Date(toDate);
    to.setHours(23, 59, 59, 999);
    where.created_at = { ...(where.created_at as object ?? {}), lte: to };
  }

  // جلب جميع حركات الأسنان غير الملغاة المطابقة للشروط بدون قيد عدد
  const transactions = await prisma.transaction.findMany({
    where,
    include: {
      beneficiary: {
        select: {
          name: true,
          card_number: true,
          remaining_balance: true,
        },
      },
    },
    orderBy: {
      created_at: "asc",
    },
  });

  // حساب الإجماليات الكلية
  const totalCount = transactions.length;
  const totalAmount = transactions.reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
  const totalCompanyShare = transactions.reduce((sum, tx) => sum + Number(tx.actual_company_share || 0), 0);
  const totalPatientShare = transactions.reduce((sum, tx) => sum + Number(tx.actual_patient_share || 0), 0);

  // ─── حساب الأرصدة المتبقية ديناميكياً ───
  const uniqueBenIdsForTxs = Array.from(new Set(transactions.map((tx) => tx.beneficiary_id)));
  const allBenDentalTxs = uniqueBenIdsForTxs.length > 0
    ? await prisma.transaction.findMany({
        where: {
          beneficiary_id: { in: uniqueBenIdsForTxs },
          company_id: companyId,
          type: "DENTAL",
          is_cancelled: false,
        },
        orderBy: [
          { created_at: "asc" },
          { id: "asc" },
        ],
        select: {
          id: true,
          beneficiary_id: true,
          ceiling_consumed: true,
          amount: true,
          actual_company_share: true,
        },
      })
    : [];

  const txsByBenMap = new Map();
  for (const t of allBenDentalTxs) {
    if (!txsByBenMap.has(t.beneficiary_id)) {
      txsByBenMap.set(t.beneficiary_id, []);
    }
    txsByBenMap.get(t.beneficiary_id).push(t);
  }

  const remainingAfterTxId = new Map();

  for (const [, benTxs] of txsByBenMap.entries()) {
    let accumulatedSpent = 0;
    for (const t of benTxs) {
      const consumed = t.ceiling_consumed !== null
        ? Number(t.ceiling_consumed)
        : Number(t.actual_company_share ?? t.amount);
      accumulatedSpent += consumed;
      remainingAfterTxId.set(t.id, Math.max(0, dentalCeiling - accumulatedSpent));
    }
  }

  // تقسيم الحركات إلى مجموعات لكل صفحة طباعة
  const totalPrintPages = Math.ceil(totalCount / ROWS_PER_PRINT_PAGE) || 1;
  const pages: typeof transactions[] = [];
  for (let i = 0; i < totalPrintPages; i++) {
    pages.push(transactions.slice(i * ROWS_PER_PRINT_PAGE, (i + 1) * ROWS_PER_PRINT_PAGE));
  }

  const copay = Math.max(0, 100 - Number(company.dental_coverage));

  return (
    <div dir="rtl" style={{ backgroundColor: "#fff", color: "#000", margin: "0", padding: "0" }} className="min-h-screen">
      <style dangerouslySetInnerHTML={{ __html: `
        @media print {
          @page { 
            size: A4 landscape; 
            margin: 1cm 1.2cm;
          }
          html, body { 
            background: white !important; 
            color: black !important;
          }
          .no-print { display: none !important; }
          .print-page { page-break-after: always; page-break-inside: avoid; }
          .print-page:last-child { page-break-after: auto; }
          table { border-collapse: collapse !important; }
          thead { display: table-header-group; }
          tfoot { display: table-footer-group; }
          tr { page-break-inside: avoid; }
        }
        .print-page { padding: 28px 32px; }
        @media screen {
          .print-page { border-bottom: 3px dashed #cbd5e1; margin-bottom: 32px; }
          .print-page:last-child { border-bottom: none; }
        }
      ` }} />

      <div id="printable-report" className="max-w-6xl mx-auto">
        {pages.map((pageTxs, pageIdx) => {
          const globalStart = pageIdx * ROWS_PER_PRINT_PAGE;

          return (
            <div key={pageIdx} className="print-page">
              {/* ترويسة كل صفحة */}
              <div className="flex items-start justify-between border-b-4 border-teal-600 pb-3 mb-4">
                <div className="space-y-0.5">
                  <h1 className="text-xl font-black tracking-tight text-slate-900">Waha Health Care</h1>
                  <p className="text-[10px] text-slate-500 font-bold">منظومة إدارة مطالبات التأمين الطبي</p>
                </div>
                <div className="text-center">
                  <h2 className="text-lg font-black text-teal-800">كشف حركات الأسنان المخصصة</h2>
                  <p className="text-xs font-bold text-slate-600 mt-0.5">شركة التأمين: {company.name}</p>
                  {copay > 0 && (
                    <p className="text-[10px] font-black text-amber-700 mt-0.5">نسبة التحمل: {copay}% | السقف: {dentalCeiling.toLocaleString("ar-LY")} د.ل</p>
                  )}
                  {(searchQuery || fromDate || toDate) && (
                    <p className="text-[10px] font-black text-teal-700 mt-0.5">
                      {searchQuery ? `بحث: "${searchQuery}" ` : ""}{fromDate ? `من: ${fromDate} ` : ""}{toDate ? `إلى: ${toDate}` : ""}
                    </p>
                  )}
                </div>
                <div className="text-left space-y-0.5 text-xs">
                  <p className="font-bold text-slate-800">المرفق: <span className="font-black text-teal-700">{session.name}</span></p>
                  <p className="text-slate-500 font-bold">تاريخ الطباعة: {formatDateTripoli(new Date())}</p>
                  <p className="text-[10px] font-black text-slate-500">
                    صفحة {pageIdx + 1} من {totalPrintPages} | إجمالي: {totalCount} حركة
                  </p>
                </div>
              </div>

              {/* الجدول الرئيسي */}
              <table className="w-full text-right border-collapse text-[11px] border border-slate-400">
                <thead>
                  <tr className="bg-slate-100 border-b-2 border-slate-400 text-slate-800">
                    <th className="border border-slate-400 px-2 py-2 text-center font-black w-8">#</th>
                    <th className="border border-slate-400 px-2 py-2 font-black">اسم المستفيد</th>
                    <th className="border border-slate-400 px-2 py-2 font-black">رقم البطاقة</th>
                    <th className="border border-slate-400 px-2 py-2 text-center font-black">قيمة الفاتورة</th>
                    <th className="border border-slate-400 px-2 py-2 text-center font-black">حصة الشركة</th>
                    <th className="border border-slate-400 px-2 py-2 text-center font-black">حصة المؤمن (كاش)</th>
                    <th className="border border-slate-400 px-2 py-2 text-center font-black">الرصيد المتبقي</th>
                    <th className="border border-slate-400 px-2 py-2 font-black">التاريخ</th>
                  </tr>
                </thead>
                <tbody>
                  {pageTxs.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="border border-slate-400 px-3 py-8 text-center text-slate-500 font-bold">
                        لا توجد حركات أسنان مسجلة.
                      </td>
                    </tr>
                  ) : (
                    pageTxs.map((tx, idx) => {
                      const amount = Number(tx.amount || 0);
                      const companyShare = tx.actual_company_share !== null ? Number(tx.actual_company_share) : 0;
                      const patientShare = tx.actual_patient_share !== null ? Number(tx.actual_patient_share) : 0;
                      const remaining = remainingAfterTxId.get(tx.id) ?? (tx.remaining_ceiling_after !== null ? Number(tx.remaining_ceiling_after) : (dentalCeiling - companyShare));
                      const rowNum = globalStart + idx + 1;
                      const isEven = rowNum % 2 === 0;

                      return (
                        <tr key={tx.id} style={{ backgroundColor: isEven ? "#f8fafc" : "#ffffff" }} className="border-b border-slate-300">
                          <td className="border border-slate-300 px-2 py-1.5 text-center font-bold text-slate-600">{rowNum}</td>
                          <td className="border border-slate-300 px-2 py-1.5 font-black text-slate-900">{tx.beneficiary?.name || "—"}</td>
                          <td className="border border-slate-300 px-2 py-1.5 font-mono font-bold text-slate-700">{tx.beneficiary?.card_number || "—"}</td>
                          <td className="border border-slate-300 px-2 py-1.5 text-center font-mono font-black">{amount.toLocaleString("ar-LY", { minimumFractionDigits: 2 })} د.ل</td>
                          <td className="border border-slate-300 px-2 py-1.5 text-center font-mono font-black text-teal-800">{companyShare.toLocaleString("ar-LY", { minimumFractionDigits: 2 })} د.ل</td>
                          <td className="border border-slate-300 px-2 py-1.5 text-center font-mono font-black text-amber-700">{patientShare.toLocaleString("ar-LY", { minimumFractionDigits: 2 })} د.ل</td>
                          <td className="border border-slate-300 px-2 py-1.5 text-center font-mono font-black text-sky-800">{remaining !== null ? `${remaining.toLocaleString("ar-LY", { minimumFractionDigits: 2 })} د.ل` : "—"}</td>
                          <td className="border border-slate-300 px-2 py-1.5 font-bold text-slate-700">
                            {formatDateTripoli(tx.created_at)}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
                {/* الإجمالي الكلي — يظهر فقط في الصفحة الأخيرة */}
                {pageIdx === totalPrintPages - 1 && (
                  <tfoot>
                    <tr className="bg-slate-200 text-slate-900 font-black text-[11px]">
                      <td colSpan={3} className="border border-slate-400 px-2 py-2.5 text-right font-black text-slate-800">
                        الإجمالي الكلي ({totalCount} حركة)
                      </td>
                      <td className="border border-slate-400 px-2 py-2.5 text-center font-black text-slate-900">
                        {totalAmount.toLocaleString("ar-LY", { minimumFractionDigits: 2 })} د.ل
                      </td>
                      <td className="border border-slate-400 px-2 py-2.5 text-center font-black text-teal-800">
                        {totalCompanyShare.toLocaleString("ar-LY", { minimumFractionDigits: 2 })} د.ل
                      </td>
                      <td className="border border-slate-400 px-2 py-2.5 text-center font-black text-amber-700">
                        {totalPatientShare.toLocaleString("ar-LY", { minimumFractionDigits: 2 })} د.ل
                      </td>
                      <td colSpan={2} className="border border-slate-400 px-2 py-2.5" />
                    </tr>
                  </tfoot>
                )}
              </table>

              {/* حقل التوقيع - يظهر فقط في الصفحة الأخيرة */}
              {pageIdx === totalPrintPages - 1 && (
                <div className="pt-10 grid grid-cols-3 gap-8 text-center text-xs font-bold text-slate-700">
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
              )}
            </div>
          );
        })}
      </div>

      {/* الطباعة التلقائية مع تأخير بسيط لضمان اكتمال التحميل */}
      <AutoPrint delay={1400} />

      {/* زر العودة يختفي عند الطباعة */}
      <div className="no-print pt-6 flex justify-center pb-12">
        <BackButton />
      </div>
    </div>
  );
}

