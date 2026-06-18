import { redirect } from "next/navigation";
import { notFound } from "next/navigation";
import prisma from "@/lib/prisma";
import { getSessionWithFreshPermissions, hasPermission } from "@/lib/session-guard";
import { formatDateTripoli } from "@/lib/datetime";
import { BackButton } from "@/components/back-button";
import { AutoPrint } from "@/components/auto-print";
import { getServiceAlias } from "@/lib/service-aliases";

const ROWS_PER_PRINT_PAGE = 30;
// حد أقصى للحركات في صفحة الطباعة لتجنب تعطل الخادم
const MAX_PRINT_ROWS = 2000;

export default async function OpticsCompanyPrintPage({
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
  const canAccess = hasPermission(session, "optics_services");
  if (!canAccess) redirect("/dashboard");

  const { companyId } = await params;
  const sp = await searchParams;
  const searchQuery = (sp.q ?? "").trim();
  const fromDate = sp.from ?? "";
  const toDate = sp.to ?? "";

  // جلب بيانات الشركة
  const company = (await prisma.insuranceCompany.findUnique({
    where: { id: companyId, deleted_at: null, is_active: true },
    include: {
      service_policies: {
        where: { service_type: { code: 'OPTICS' } },
        select: { ceiling_amount: true, coverage_percent: true }
      }
    }
  })) as any;

  if (!company) notFound();

  const opticsPolicy = company.service_policies?.[0];
  const ceiling = opticsPolicy && opticsPolicy.ceiling_amount !== null ? Number(opticsPolicy.ceiling_amount) : null;
  const opticsCeiling = ceiling;

  // بناء شروط الاستعلام
  const isFacility = session.role === "FACILITY" || (!session.is_admin && !session.is_manager && !session.is_employee);
  const where: any = {
    company_id: companyId,
    type: "OPTICS",
    is_cancelled: false,
    ...(isFacility ? { facility_id: session.id } : {}),
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

  // جلب عدد الحركات أولاً قبل جلب البيانات الكاملة
  const totalCount = await prisma.transaction.count({ where });

  // ─── إذا لا توجد حركات: أظهر رسالة ولا تطبع ───
  if (totalCount === 0) {
    return (
      <div
        dir="rtl"
        style={{ backgroundColor: "#fff", color: "#000", margin: "0", padding: "0" }}
        className="min-h-screen flex flex-col items-center justify-center"
      >
        <div className="max-w-md w-full mx-auto px-6 py-16 text-center">
          <div className="mb-6">
            <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full border-4 border-slate-200 bg-slate-50">
              <svg
                className="h-10 w-10 text-slate-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
                />
              </svg>
            </div>
            <h1 className="text-2xl font-black text-slate-800 mb-2">لا توجد حركات للطباعة</h1>
            <p className="text-slate-500 font-medium">
              لم يتم العثور على أي حركات بصريات
              {(searchQuery || fromDate || toDate) && " مطابقة للفلاتر المحددة"}
              {" "}لشركة <strong className="text-slate-700">{company.name}</strong>.
            </p>
            {(searchQuery || fromDate || toDate) && (
              <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                <p className="font-bold">الفلاتر المطبقة:</p>
                {searchQuery && <p>بحث: &quot;{searchQuery}&quot;</p>}
                {fromDate && <p>من: {fromDate}</p>}
                {toDate && <p>إلى: {toDate}</p>}
              </div>
            )}
          </div>
          <div className="flex justify-center">
            <BackButton />
          </div>
        </div>
      </div>
    );
  }

  // ─── تحذير إذا كان العدد كبيراً جداً ───
  const isTruncated = totalCount > MAX_PRINT_ROWS;

  // جلب جميع حركات البصريات غير الملغاة المطابقة للشروط
  const transactions = (await prisma.transaction.findMany({
    where,
    take: MAX_PRINT_ROWS,
    include: {
      beneficiary: {
        select: {
          name: true,
          card_number: true,
          remaining_balance: true,
        },
      },
      facility: {
        select: {
          id: true,
          name: true,
        },
      },
    },
    orderBy: {
      created_at: "asc",
    },
  })) as any;

  // حساب الإجماليات الكلية
  const shownCount = transactions.length;
  const totalAmount = transactions.reduce((sum: number, tx: any) => sum + Number(tx.amount || 0), 0);
  const totalCompanyShare = transactions.reduce((sum: number, tx: any) => sum + Number(tx.actual_company_share || 0), 0);
  const totalPatientShare = transactions.reduce((sum: number, tx: any) => sum + Number(tx.actual_patient_share || 0), 0);

  // ─── حساب الأرصدة المتبقية ديناميكياً ───
  const uniqueBenIdsForTxs = Array.from(new Set(transactions.map((tx: any) => tx.beneficiary_id))) as string[];
  const allBenOpticsTxs = uniqueBenIdsForTxs.length > 0
    ? await prisma.transaction.findMany({
        where: {
          beneficiary_id: { in: uniqueBenIdsForTxs },
          company_id: companyId,
          type: "OPTICS",
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
  for (const t of allBenOpticsTxs) {
    if (!txsByBenMap.has(t.beneficiary_id)) {
      txsByBenMap.set(t.beneficiary_id, []);
    }
    txsByBenMap.get(t.beneficiary_id).push(t);
  }

  const remainingAfterTxId = new Map();
  const accumulatedSpentByTxId = new Map();

  for (const [, benTxs] of txsByBenMap.entries()) {
    let accumulatedSpent = 0;
    for (const t of benTxs) {
      const consumed = t.ceiling_consumed !== null
        ? Number(t.ceiling_consumed)
        : Number(t.actual_company_share ?? t.amount);
      accumulatedSpent += consumed;
      accumulatedSpentByTxId.set(t.id, accumulatedSpent);
      remainingAfterTxId.set(t.id, opticsCeiling === null ? 999999999 : Math.max(0, opticsCeiling - accumulatedSpent));
    }
  }

  // تقسيم الحركات إلى مجموعات لكل صفحة طباعة
  const totalPrintPages = Math.ceil(shownCount / ROWS_PER_PRINT_PAGE) || 1;
  const pages: typeof transactions[] = [];
  for (let i = 0; i < totalPrintPages; i++) {
    pages.push(transactions.slice(i * ROWS_PER_PRINT_PAGE, (i + 1) * ROWS_PER_PRINT_PAGE));
  }

  const copay = Math.max(0, 100 - (opticsPolicy ? Number(opticsPolicy.coverage_percent) : 100));

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

      {/* تحذير الاقتطاع عند تجاوز الحد */}
      {isTruncated && (
        <div className="no-print bg-amber-50 border-b-2 border-amber-300 px-6 py-3 text-center text-sm font-bold text-amber-800">
          ⚠ يوجد {totalCount.toLocaleString("ar-LY")} حركة — يُعرض أول {MAX_PRINT_ROWS.toLocaleString("ar-LY")} حركة فقط. استخدم فلتر التاريخ لتضييق النتائج.
        </div>
      )}

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
                  <h2 className="text-lg font-black text-teal-800">كشف حركات {getServiceAlias(company, 'OPTICS', "البصريات")} المخصصة</h2>
                  <p className="text-xs font-bold text-slate-600 mt-0.5">شركة التأمين: {company.name}</p>
                  {copay > 0 && (
                    <p className="text-[10px] font-black text-amber-700 mt-0.5">نسبة التحمل: {copay}% | السقف: {opticsCeiling !== null ? `${opticsCeiling.toLocaleString("ar-LY")} د.ل` : "مفتوح"}</p>
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
                    صفحة {pageIdx + 1} من {totalPrintPages} | إجمالي: {isTruncated ? `${shownCount} من ${totalCount}` : totalCount} حركة
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
                    <th className="border border-slate-400 px-2 py-2 text-center font-black">
                       {opticsCeiling === null ? "الرصيد المستهلك" : "الرصيد المتبقي"}
                     </th>
                    <th className="border border-slate-400 px-2 py-2 font-black">المرفق</th>
                    <th className="border border-slate-400 px-2 py-2 font-black">التاريخ</th>
                  </tr>
                </thead>
                <tbody>
                  {pageTxs.map((tx: any, idx: number) => {
                    const amount = Number(tx.amount || 0);
                    const companyShare = tx.actual_company_share !== null ? Number(tx.actual_company_share) : 0;
                    const patientShare = tx.actual_patient_share !== null ? Number(tx.actual_patient_share) : 0;
                    const remaining = remainingAfterTxId.get(tx.id) ?? (tx.remaining_ceiling_after !== null ? Number(tx.remaining_ceiling_after) : (opticsCeiling !== null ? (opticsCeiling - companyShare) : 999999999));
                    const consumedAccumulated = accumulatedSpentByTxId.get(tx.id) ?? companyShare;
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
                        <td className="border border-slate-300 px-2 py-1.5 text-center font-mono font-black text-sky-800">
                          {remaining !== null && remaining < 99999999 ? (
                            `${remaining.toLocaleString("ar-LY", { minimumFractionDigits: 2 })} د.ل`
                          ) : (
                            `${consumedAccumulated.toLocaleString("ar-LY", { minimumFractionDigits: 2 })} د.ل`
                          )}
                        </td>
                        <td className="border border-slate-300 px-2 py-1.5 font-bold text-slate-700">{tx.facility?.name || "—"}</td>
                        <td className="border border-slate-300 px-2 py-1.5 font-bold text-slate-700">
                          {formatDateTripoli(tx.created_at)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                {/* الإجمالي الكلي — يظهر فقط في الصفحة الأخيرة */}
                {pageIdx === totalPrintPages - 1 && (
                  <tfoot>
                    <tr className="bg-slate-200 text-slate-900 font-black text-[11px]">
                      <td colSpan={3} className="border border-slate-400 px-2 py-2.5 text-right font-black text-slate-800">
                        الإجمالي الكلي ({shownCount} حركة{isTruncated ? ` من ${totalCount}` : ""})
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
