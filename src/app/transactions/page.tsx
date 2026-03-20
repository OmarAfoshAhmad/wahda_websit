import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { Shell } from "@/components/shell";
import { Card, Badge, Input, Button } from "@/components/ui";
import { PrintButton } from "@/components/print-button";
import { ExportButton } from "@/components/export-button";
import { TransactionCancelButton } from "@/components/transaction-cancel-button";
import Link from "next/link";

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: { start_date?: string; end_date?: string; facility_id?: string; page?: string; q?: string };
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  const { start_date, end_date, facility_id, page: pageParam, q } = await searchParams;
  const PAGE_SIZE = 50;
  const page = Math.max(1, parseInt(pageParam ?? "1", 10) || 1);

  // كل مرفق يرى حركاته فقط — المشرف يرى الكل ويمكنه الفلترة
  const where: Record<string, any> = session.is_admin
    ? (facility_id ? { facility_id } : {})
    : { facility_id: session.id };

  // فلترة بالبحث (اسم أو رقم بطاقة)
  if (q && q.trim() !== "") {
    where.OR = [
      { beneficiary: { name: { contains: q, mode: "insensitive" } } },
      { beneficiary: { card_number: { contains: q, mode: "insensitive" } } },
    ];
  }

  // فلترة بالتاريخ (من - إلى)
  if (start_date || end_date) {
    where.created_at = {};
    if (start_date) {
      const start = new Date(start_date);
      if (!isNaN(start.getTime())) {
        where.created_at.gte = start;
      }
    }
    if (end_date) {
      const end = new Date(end_date);
      if (!isNaN(end.getTime())) {
        // نضبط الوقت لنهاية اليوم لضمان شمولية اليوم المحدد
        end.setHours(23, 59, 59, 999);
        where.created_at.lte = end;
      }
    }
  }

  const [transactions, totalCount, aggregate, allTransactionsForSums] = await Promise.all([
    prisma.transaction.findMany({
      where,
      orderBy: { created_at: "desc" },
      include: {
        beneficiary: true,
        facility: true,
      },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.transaction.count({ where }),
    prisma.transaction.aggregate({
      where,
      _sum: {
        amount: true,
      },
    }),
    // لجلب إجمالي الرصيد المتبقي لكل العمليات المطابقة للفلتر
    prisma.transaction.findMany({
      where,
      select: {
        beneficiary: {
          select: {
            remaining_balance: true
          }
        }
      }
    }),
  ]);

  const totalAmount = aggregate._sum.amount ?? 0;
  const totalRemaining = allTransactionsForSums.reduce((sum, tx) => sum + Number(tx.beneficiary.remaining_balance), 0);
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  // حساب إجمالي المتبقي للصفحة الحالية — غير مستخدم في التقرير الشامل
  const currentViewTotalRemaining = transactions.reduce((sum, tx) => sum + Number(tx.beneficiary.remaining_balance), 0);
  const currentViewTotalAmount = transactions.reduce((sum, tx) => sum + Number(tx.amount), 0);

  // المشرف يرى قائمة كل المرافق في الفلتر
  const facilities = session.is_admin
    ? await prisma.facility.findMany({ where: { deleted_at: null }, select: { id: true, name: true }, orderBy: { name: "asc" } })
    : [{ id: session.id, name: session.name }];

  return (
    <Shell facilityName={session.name} isAdmin={session.is_admin}>
      <div id="printable-report" className="space-y-4 pb-20">

        {/* ترويسة الطباعة فقط */}
        <div className="hidden print:flex flex-col items-center justify-center mb-2 text-center border-b pb-2 pt-2">
           {/* eslint-disable-next-line @next/next/no-img-element */}
           <img src="/logo.png" alt="Waha Healthy Care" className="h-16 w-auto object-contain mb-2" />
           <h1 className="text-xl font-black text-black">Waha Healthy Care</h1>
           <h2 className="text-lg font-bold text-black mt-1">سجل الحركات (المراجعة الطبية)</h2>
           <p className="text-sm text-black mt-1 opacity-75">تاريخ استخراج التقرير: {new Date().toLocaleDateString("ar-LY")}</p>
           {session.is_admin && facility_id && <p className="text-sm font-bold mt-1 text-black">خاص بالمرفق: {facilities.find(f => f.id === facility_id)?.name}</p>}
        </div>
        
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mb-2 print:hidden">
          <div>
            <h1 className="text-2xl font-black text-slate-900">سجل الحركات (المراجعة الطبية)</h1>
            <p className="text-sm text-slate-500">تقرير مفصل بجميع العمليات</p>
          </div>
          <div className="no-print flex items-center gap-2">
            <ExportButton searchParams={searchParams} />
            <PrintButton />
          </div>
        </div>

        {/* ملخص التقرير */}
        {(start_date || end_date) && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 mb-6">
            <Card className="p-4 bg-blue-50 border-blue-100">
              <p className="text-xs font-bold text-blue-600 uppercase">إجمالي المبلغ</p>
              <p className="text-2xl font-black text-blue-900 mt-1">{Number(totalAmount).toLocaleString("ar-LY")} د.ل</p>
            </Card>
            <Card className="p-4 bg-emerald-50 border-emerald-100">
              <p className="text-xs font-bold text-emerald-600 uppercase">عدد العمليات</p>
              <p className="text-2xl font-black text-emerald-900 mt-1">{totalCount.toLocaleString("ar-LY")}</p>
            </Card>
            <Card className="p-4 bg-slate-50 border-slate-100">
               <p className="text-xs font-bold text-slate-500 uppercase">الفترة</p>
               <p className="text-sm font-semibold text-slate-700 mt-2 dir-rtl">
                 {start_date ? `من ${start_date}` : "من البداية"}
                 {" - "}
                 {end_date ? `إلى ${end_date}` : "إلى الآن"}
               </p>
            </Card>
          </div>
        )}

        <form className="mb-1 flex flex-col gap-2 sm:flex-row sm:items-end" method="get">
          <input type="hidden" name="page" value="1" />
          <input type="hidden" name="start_date" value={start_date ?? ""} />
          <input type="hidden" name="end_date" value={end_date ?? ""} />
          <input type="hidden" name="facility_id" value={facility_id ?? ""} />
          <div className="w-full">
            <label className="block text-xs font-black text-slate-400 mb-1">بحث باسم المستفيد أو رقم البطاقة</label>
            <Input
              type="search"
              name="q"
              defaultValue={q ?? ""}
              placeholder="ابحث باسم المستفيد أو رقم البطاقة..."
              className="h-10 text-sm"
              autoComplete="off"
              dir="auto"
            />
          </div>
          <Button type="submit" className="mt-2 h-10 w-full sm:mt-0 sm:w-auto">بحث</Button>
        </form>

        <Card className="p-3.5 sm:p-4">
          <form className="flex flex-col gap-4">
            <input type="hidden" name="page" value="1" />
            <input type="hidden" name="q" value={q ?? ""} />
            
            <div className={`grid grid-cols-1 gap-4 ${session.is_admin ? "md:grid-cols-4" : "md:grid-cols-3"}`}>
              <div className="space-y-1">
                <label className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">من تاريخ</label>
                <Input type="date" name="start_date" defaultValue={start_date} />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">إلى تاريخ</label>
                <Input type="date" name="end_date" defaultValue={end_date} />
              </div>
              
              {session.is_admin && (
                <div className="space-y-1">
                  <label className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">المرفق</label>
                  <select
                    name="facility_id"
                    defaultValue={facility_id}
                    className="flex h-10 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
                  >
                    <option value="">كل المرافق</option>
                    {facilities.map((f: { id: string; name: string }) => (
                      <option key={f.id} value={f.id}>{f.name}</option>
                    ))}
                  </select>
                </div>
              )}
              
              <div className="flex items-end">
                <button type="submit" className="w-full rounded-md bg-primary px-4 py-2.5 text-sm font-black text-white transition-colors hover:bg-primary-dark">
                  عرض التقرير
                </button>
              </div>
            </div>
          </form>
        </Card>

        {/* ══ عرض الكارد — جوال فقط ══ */}
        <div className="flex flex-col gap-3 sm:hidden">
          {transactions.length === 0 ? (
            <p className="py-10 text-center italic text-slate-500">لا توجد نتائج مطابقة للفلاتر الحالية.</p>
          ) : (
            transactions.map((tx) => (
              <Card key={tx.id} className="overflow-hidden p-0">
                {/* رأس الكارد */}
                <div className="flex items-center justify-between gap-3 border-b border-slate-100 bg-slate-50 px-4 py-2.5">
                  <span className="text-xs text-slate-500">
                    {new Date(tx.created_at).toLocaleDateString("ar-LY", { day: "numeric", month: "long", year: "numeric" })}
                    {" · "}
                    {new Date(tx.created_at).toLocaleTimeString("ar-LY", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                  <Badge variant={tx.type === "MEDICINE" ? "default" : "warning"}>
                    {tx.type === "MEDICINE" ? "ادوية صرف عام" : "كشف عام"}
                  </Badge>
                </div>
                {/* جسم الكارد */}
                <div className="flex items-center justify-between gap-3 px-4 py-3.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-base font-black text-slate-900">{tx.beneficiary.name}</p>
                    <p className="mt-0.5 text-xs font-medium text-slate-400">بطاقة: {tx.beneficiary.card_number}</p>
                    {session.is_admin && (
                      <p className="mt-1 text-xs font-bold text-primary">{tx.facility.name}</p>
                    )}
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-2xl font-black tabular-nums text-slate-900">{Number(tx.amount).toLocaleString("ar-LY")}</p>
                    <p className="text-xs font-medium text-slate-400">دينار ليبي</p>
                  </div>
                </div>
              </Card>
            ))
          )}
        </div>

        {/* ══ عرض الجدول — شاشة كبيرة فقط ══ */}
        <Card className="hidden overflow-hidden pb-0 sm:block">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead className="border-b border-slate-200 bg-slate-50">
                <tr>
                  <th className="px-6 py-4 text-xs font-black text-slate-400">#</th>
                  <th className="px-6 py-4 text-xs font-black text-slate-400">المستفيد</th>
                  {session.is_admin && <th className="px-6 py-4 text-xs font-black text-slate-400">المرفق</th>}
                  <th className="px-6 py-4 text-xs font-black text-slate-400">النوع</th>
                  <th className="px-6 py-4 text-xs font-black text-slate-400 text-right">القيمة المخصومة</th>
                  <th className="px-6 py-4 text-xs font-black text-slate-400 text-right">الرصيد المتبقي</th>
                  <th className="px-6 py-4 text-xs font-black text-slate-400 text-right">التاريخ</th>
                  <th className="px-6 py-4 text-xs font-black text-slate-400 text-center">الحالة</th>
                  {session.is_admin && <th className="px-6 py-4 text-xs font-black text-slate-400 no-print">إلغاء</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {transactions.length === 0 ? (
                  <tr>
                    <td colSpan={session.is_admin ? 9 : 8} className="px-6 py-10 text-center italic text-slate-500">لا توجد نتائج مطابقة للفلاتر الحالية.</td>
                  </tr>
                ) : (
                  transactions.map((tx, idx) => (
                    <tr key={tx.id} className={`transition-colors hover:bg-slate-50 ${tx.is_cancelled ? "bg-red-50/50 hover:bg-red-50" : ""} ${tx.type === "CANCELLATION" ? "bg-green-50/50 hover:bg-green-50" : ""}`}>
                      <td className="px-6 py-4 font-mono text-xs text-slate-500 font-bold">{(page - 1) * PAGE_SIZE + idx + 1}</td>
                      <td className="px-6 py-4">
                        <p className="font-bold text-slate-900">{tx.beneficiary.name}</p>
                        <p className="text-xs text-slate-500">{tx.beneficiary.card_number}</p>
                      </td>
                      {session.is_admin && (
                        <td className="px-6 py-4 text-sm font-medium text-slate-600">
                          {tx.facility.name}
                        </td>
                      )}
                      <td className="px-6 py-4">
                        {tx.type === "CANCELLATION" ? (
                           <Badge variant="success">إلغاء حركة</Badge>
                        ) : (
                           <Badge variant={tx.type === "MEDICINE" ? "default" : "warning"}>
                             {tx.type === "MEDICINE" ? "ادوية صرف عام" : "كشف عام"}
                           </Badge>
                        )}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <span className={`font-black ${tx.type === "CANCELLATION" ? "text-green-700" : (tx.is_cancelled ? "text-slate-400 line-through" : "text-slate-900")}`}>
                          {Number(tx.amount).toLocaleString("ar-LY")}
                        </span>
                        <span className="mr-3 text-[10px] text-slate-400">د.ل</span>
                      </td>
                      <td className="px-6 py-4 text-right">
                         <span className="font-medium text-slate-700">{Number(tx.beneficiary.remaining_balance).toLocaleString("ar-LY")}</span>
                         <span className="mr-3 text-[10px] text-slate-400">د.ل</span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <p className="text-sm text-slate-900">{new Date(tx.created_at).toLocaleDateString("ar-LY")}</p>
                      </td>
                      <td className="px-6 py-4 text-center">
                        {tx.is_cancelled ? (
                          <span className="font-bold text-red-600 text-xs text-nowrap">ملغاة</span>
                        ) : tx.type === "CANCELLATION" ? (
                          <span className="font-bold text-green-600 text-xs text-nowrap">حركة مصححة</span>
                        ) : (
                          <span className="font-bold text-slate-500 text-xs text-nowrap">منفذة</span>
                        )}
                      </td>
                      {session.is_admin && (
                        <td className="px-6 py-4 text-center no-print">
                          <TransactionCancelButton transactionId={tx.id} isCancelled={tx.is_cancelled} type={tx.type} />
                        </td>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
              {transactions.length > 0 && (
                <tfoot className="bg-slate-50 border-t border-slate-200 font-black">
                  <tr>
                    <td colSpan={session.is_admin ? 4 : 3} className="px-6 py-4 text-left">الإجمالي الكلي</td>
                    <td className="px-6 py-4 text-right">
                      <span>{Number(totalAmount).toLocaleString("ar-LY")}</span>
                      <span className="mr-3 text-[10px] text-slate-400">د.ل</span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <span>{Number(totalRemaining).toLocaleString("ar-LY")}</span>
                      <span className="mr-3 text-[10px] text-slate-400">د.ل</span>
                    </td>
                    <td colSpan={2}></td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </Card>
      </div>

      {/* ══ شريط الإحصائيات الثابت في أسفل الشاشة دائماً ══ */}
      <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-slate-200 bg-white/95 backdrop-blur-sm shadow-[0_-1px_8px_rgba(0,0,0,0.06)]">
        <div className="mx-auto max-w-7xl px-3 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between gap-4 py-3">
            {/* إحصائيات */}
            <div className="flex items-center gap-5 text-sm">
              <span className="text-slate-500">
                الإجمالي:{" "}
                <strong className="font-black text-slate-900">
                  {totalCount.toLocaleString("ar-LY")}
                </strong>{" "}
                عملية
              </span>
              {totalPages > 1 && (
                <span className="hidden sm:inline text-slate-400">
                  صفحة <strong className="text-slate-700">{page}</strong> من{" "}
                  <strong className="text-slate-700">{totalPages}</strong>
                </span>
              )}
            </div>

            {/* أزرار التنقل */}
            <div className="flex gap-2">
              {page > 1 ? (
                <Link
                  href={`/transactions?${new URLSearchParams({ ...(start_date ? { start_date } : {}), ...(end_date ? { end_date } : {}), ...(facility_id ? { facility_id } : {}), ...(q ? { q } : {}), page: String(page - 1) }).toString()}`}
                  className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-700 transition-colors hover:bg-slate-50"
                >
                  &#8592; السابق
                </Link>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-md border border-slate-100 bg-slate-50 px-4 py-2 text-sm font-black text-slate-300 cursor-not-allowed">
                  &#8592; السابق
                </span>
              )}
              {page < totalPages ? (
                <Link
                  href={`/transactions?${new URLSearchParams({ ...(start_date ? { start_date } : {}), ...(end_date ? { end_date } : {}), ...(facility_id ? { facility_id } : {}), ...(q ? { q } : {}), page: String(page + 1) }).toString()}`}
                  className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-700 transition-colors hover:bg-slate-50"
                >
                  التالي &#8594;
                </Link>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-md border border-slate-100 bg-slate-50 px-4 py-2 text-sm font-black text-slate-300 cursor-not-allowed">
                  التالي &#8594;
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </Shell>
  );
}
