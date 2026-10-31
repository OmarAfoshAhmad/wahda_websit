import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { getSessionWithFreshPermissions, hasPermission } from "@/lib/session-guard";
import { canAccessAdmin } from "@/lib/permissions";
import { getAllowedCompanyIds } from "@/lib/company-scope";
import { PrintButton } from "@/components/print-button";
import { buildDispenseWhere, DISPENSE_CATEGORIES, type DispenseFilterParams } from "@/lib/pharmacy/dispense-filter";
import { formatDateTripoli } from "@/lib/datetime";

const MAX_ROWS = 5000;
const money = (value: unknown) => Number(value ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const when = (value: Date) => formatDateTripoli(value);

/** كشف حركات الصيدلية المصفّى للطباعة (نفس فلاتر الجدول). */
export default async function PharmacyStatementPage({ searchParams }: { searchParams: Promise<DispenseFilterParams> }) {
  const session = await getSessionWithFreshPermissions();
  if (!session) redirect("/login");
  if (!hasPermission(session, "pharmacy_services") && !hasPermission(session, "view_pharmacy_beneficiaries")) redirect("/dashboard");
  const params = await searchParams;
  const staff = canAccessAdmin(session);
  const { where, deletedView } = buildDispenseWhere(params, { allowedCompanyIds: await getAllowedCompanyIds(session), facilityId: staff ? null : session.id });

  const [rows, sums, company] = await Promise.all([
    prisma.pharmacyDispense.findMany({
      where, orderBy: { created_at: "asc" }, take: MAX_ROWS,
      select: { id: true, created_at: true, medicine_category: true, gross_total: true, company_total: true, patient_total: true, beneficiary: { select: { name: true, card_number: true } }, facility: { select: { name: true } }, company: { select: { name: true } } },
    }),
    prisma.pharmacyDispense.aggregate({ where, _sum: { gross_total: true, company_total: true, patient_total: true }, _count: true }),
    params.company ? prisma.insuranceCompany.findUnique({ where: { id: params.company }, select: { name: true } }) : null,
  ]);

  const filters = [
    company ? `الشركة: ${company.name}` : "كل الشركات",
    params.facility ? `الصيدلية: ${params.facility}` : null,
    params.category && params.category in DISPENSE_CATEGORIES ? `النوع: ${DISPENSE_CATEGORIES[params.category as keyof typeof DISPENSE_CATEGORIES]}` : null,
    params.from || params.to ? `الفترة: ${params.from || "…"} إلى ${params.to || "…"}` : null,
    params.q ? `بحث: ${params.q}` : null,
    deletedView ? "الحركات المحذوفة" : null,
  ].filter(Boolean).join(" · ");

  return (
    <div id="printable-report" dir="rtl" className="mx-auto max-w-5xl bg-white p-6 text-slate-900 print:max-w-none print:p-0">
      <style>{`@page { size: A4 landscape; margin: 10mm; } @media print { body { background: white; } #printable-report { padding: 0 !important; } #printable-report th, #printable-report td { border: 1px solid #64748b !important; } }`}</style>
      <div className="mb-4 flex justify-end print:hidden"><PrintButton /></div>
      <div className="flex items-start justify-between gap-4 border-b-2 border-slate-800 pb-3">
        <div>
          <h1 className="text-2xl font-black">كشف حركات الصيدلية</h1>
          <p className="text-sm text-slate-600">{filters}</p>
          <p className="text-xs text-slate-500">تاريخ الطباعة: <span dir="ltr">{when(new Date())}</span></p>
        </div>
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/waad-logo.png" alt="وعد" className="h-14 w-auto max-w-28 object-contain" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="الواحة للرعاية الصحية" className="h-14 w-14 object-contain" />
        </div>
      </div>

      <table className="mt-4 w-full border-collapse text-xs">
        <thead>
          <tr className="bg-slate-100">
            {["#", "التاريخ", "المستفيد", "رقم البطاقة", "النوع", ...(company ? [] : ["الشركة"]), "الصيدلية", "الإجمالي", "على الشركة", "على المستفيد"].map((label) => (
              <th key={label} className="border border-slate-300 p-1.5 text-start">{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.id}>
              <td className="border border-slate-300 p-1.5 tabular-nums">{index + 1}</td>
              <td className="border border-slate-300 p-1.5 tabular-nums" dir="ltr">{when(row.created_at)}</td>
              <td className="border border-slate-300 p-1.5">{row.beneficiary.name}</td>
              <td className="border border-slate-300 p-1.5 font-mono" dir="ltr">{row.beneficiary.card_number}</td>
              <td className="border border-slate-300 p-1.5">{DISPENSE_CATEGORIES[row.medicine_category]}</td>
              {!company && <td className="border border-slate-300 p-1.5">{row.company.name}</td>}
              <td className="border border-slate-300 p-1.5">{row.facility.name}</td>
              <td className="border border-slate-300 p-1.5 text-end tabular-nums">{money(row.gross_total)}</td>
              <td className="border border-slate-300 p-1.5 text-end tabular-nums">{money(row.company_total)}</td>
              <td className="border border-slate-300 p-1.5 text-end tabular-nums">{money(row.patient_total)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="bg-slate-100 font-black">
            <td className="border border-slate-300 p-1.5" colSpan={company ? 6 : 7}>الإجمالي ({sums._count.toLocaleString("en-US")} حركة) د.ل</td>
            <td className="border border-slate-300 p-1.5 text-end tabular-nums">{money(sums._sum.gross_total)}</td>
            <td className="border border-slate-300 p-1.5 text-end tabular-nums">{money(sums._sum.company_total)}</td>
            <td className="border border-slate-300 p-1.5 text-end tabular-nums">{money(sums._sum.patient_total)}</td>
          </tr>
        </tfoot>
      </table>
      {sums._count > MAX_ROWS && <p className="mt-2 text-xs text-amber-700">يُعرض أول {MAX_ROWS} حركة؛ الإجماليات تشمل كل الحركات. ضيّق الفترة لطباعة الباقي.</p>}
    </div>
  );
}
