import { notFound, redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { getSessionWithFreshPermissions, hasPermission } from "@/lib/session-guard";
import { assertCompanyAccessForSession } from "@/lib/company-scope";
import { canAccessAdmin } from "@/lib/permissions";
import { PrintButton } from "@/components/print-button";

const CATEGORY: Record<string, string> = { ROUTINE: "أدوية روتينية", CHRONIC: "أدوية مزمنة", CHEMICAL: "أدوية الأورام" };
const KIND: Record<string, string> = { INSURANCE_CARD: "صورة البطاقة التأمينية", PRESCRIPTION: "صورة الوصفة الطبية" };
const money = (value: unknown) => Number(value ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const when = (value: Date) => value.toLocaleString("en-GB", { timeZone: "Africa/Tripoli", dateStyle: "short", timeStyle: "short" });

/**
 * فاتورة صرف أدوية للطباعة: بيانات الصرف والبنود والتوزيع بين الشركة والمستفيد، ثم المرفقات (البطاقة والوصفة)
 * كل صورة في صفحة. يراها المرفق الذي صرف، والإدارة ضمن نطاق الشركة.
 */
export default async function PharmacyInvoicePrintPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionWithFreshPermissions();
  if (!session) redirect("/login");
  if (!hasPermission(session, "pharmacy_services") && !hasPermission(session, "view_pharmacy_beneficiaries")) redirect("/dashboard");

  const { id } = await params;
  const dispense = await prisma.pharmacyDispense.findUnique({
    where: { id },
    select: {
      id: true, created_at: true, medicine_category: true, status: true, cancellation_reason: true, cancelled_at: true,
      gross_total: true, company_total: true, patient_total: true, facility_id: true, company_id: true,
      facility: { select: { name: true } },
      company: { select: { name: true, code: true } },
      beneficiary: { select: { name: true, card_number: true } },
      transaction: { select: { id: true, is_cancelled: true } },
      prescription: { select: { prescription_number: true, attachments: { select: { id: true, kind: true, file_name: true, mime_type: true } } } },
      attachments: { select: { id: true, kind: true, file_name: true, mime_type: true } },
      items: { orderBy: { sequence: "asc" }, select: { sequence: true, price: true, coverage_percent: true, company_share: true, patient_share: true, drug: { select: { name: true } } } },
    },
  });
  if (!dispense) notFound();
  const staff = canAccessAdmin(session);
  if (!staff && dispense.facility_id !== session.id) notFound();
  if (staff) {
    try {
      await assertCompanyAccessForSession(session, dispense.company_id);
    } catch {
      notFound();
    }
  }

  const cancelled = dispense.status === "CANCELLED" || dispense.transaction.is_cancelled;
  const attachments = [...dispense.attachments, ...(dispense.prescription?.attachments ?? [])];
  const number = dispense.id.slice(-8).toUpperCase();

  return (
    <div dir="rtl" className="mx-auto max-w-3xl bg-white p-6 text-slate-900 print:max-w-none print:p-0">
      <style>{`@page { size: A4; margin: 14mm; } @media print { .page-break { break-before: page; } body { background: white; } }`}</style>
      <div className="mb-4 flex justify-end print:hidden"><PrintButton /></div>

      <header className="flex items-start justify-between gap-4 border-b-2 border-slate-800 pb-3">
        <div>
          <h1 className="text-2xl font-black">فاتورة صرف أدوية</h1>
          <p className="text-sm text-slate-600">رقم الفاتورة: <span className="font-mono font-bold" dir="ltr">{number}</span></p>
          <p className="text-sm text-slate-600">التاريخ: <span dir="ltr">{when(dispense.created_at)}</span></p>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="الواحة للرعاية الصحية" className="h-16 w-16 object-contain" />
      </header>

      {cancelled && (
        <p className="mt-3 rounded border-2 border-rose-600 p-2 text-center text-lg font-black text-rose-700">
          فاتورة ملغاة{dispense.cancellation_reason ? ` — ${dispense.cancellation_reason}` : ""}
        </p>
      )}

      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
        <div><dt className="text-slate-500">الصيدلية</dt><dd className="font-bold">{dispense.facility.name}</dd></div>
        <div><dt className="text-slate-500">شركة التأمين</dt><dd className="font-bold">{dispense.company.name} ({dispense.company.code})</dd></div>
        <div><dt className="text-slate-500">المستفيد</dt><dd className="font-bold">{dispense.beneficiary.name}</dd></div>
        <div><dt className="text-slate-500">رقم البطاقة</dt><dd className="font-mono font-bold" dir="ltr">{dispense.beneficiary.card_number}</dd></div>
        <div><dt className="text-slate-500">نوع الدواء</dt><dd className="font-bold">{CATEGORY[dispense.medicine_category]}</dd></div>
        <div><dt className="text-slate-500">رقم الوصفة</dt><dd className="font-bold">{dispense.prescription ? dispense.prescription.prescription_number : "— (مزمن)"}</dd></div>
      </dl>

      <table className="mt-5 w-full border-collapse text-sm">
        <thead>
          <tr className="bg-slate-100">
            <th className="border border-slate-300 p-2 text-start">#</th>
            <th className="border border-slate-300 p-2 text-start">البند</th>
            <th className="border border-slate-300 p-2 text-end">السعر</th>
            <th className="border border-slate-300 p-2 text-end">التغطية</th>
            <th className="border border-slate-300 p-2 text-end">على الشركة</th>
            <th className="border border-slate-300 p-2 text-end">على المستفيد</th>
          </tr>
        </thead>
        <tbody>
          {dispense.items.map((item, index) => (
            <tr key={item.sequence}>
              <td className="border border-slate-300 p-2 tabular-nums">{index + 1}</td>
              <td className="border border-slate-300 p-2" dir="auto">{item.drug?.name ?? `البند ${item.sequence} في الوصفة`}</td>
              <td className="border border-slate-300 p-2 text-end tabular-nums">{money(item.price)}</td>
              <td className="border border-slate-300 p-2 text-end tabular-nums">{Number(item.coverage_percent)}%</td>
              <td className="border border-slate-300 p-2 text-end tabular-nums">{money(item.company_share)}</td>
              <td className="border border-slate-300 p-2 text-end tabular-nums">{money(item.patient_share)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="bg-slate-100 font-black">
            <td className="border border-slate-300 p-2" colSpan={2}>الإجمالي (د.ل)</td>
            <td className="border border-slate-300 p-2 text-end tabular-nums">{money(dispense.gross_total)}</td>
            <td className="border border-slate-300 p-2" />
            <td className="border border-slate-300 p-2 text-end tabular-nums">{money(dispense.company_total)}</td>
            <td className="border border-slate-300 p-2 text-end tabular-nums">{money(dispense.patient_total)}</td>
          </tr>
        </tfoot>
      </table>

      <div className="mt-10 grid grid-cols-2 gap-8 text-sm">
        <div className="border-t border-slate-400 pt-1 text-center">توقيع وختم الصيدلية</div>
        <div className="border-t border-slate-400 pt-1 text-center">توقيع المستفيد بالاستلام</div>
      </div>
      <p className="mt-4 text-xs text-slate-500">المرفقات: {attachments.length ? attachments.map((item) => KIND[item.kind ?? ""] ?? item.file_name).join("، ") : "لا توجد"} · مرجع الحركة <span className="font-mono" dir="ltr">{dispense.transaction.id.slice(-8).toUpperCase()}</span></p>

      {attachments.map((attachment) => (
        <section key={attachment.id} className="page-break mt-8 print:mt-0">
          <h2 className="mb-2 border-b border-slate-300 pb-1 text-base font-black">{KIND[attachment.kind ?? ""] ?? "مرفق"} — فاتورة <span className="font-mono" dir="ltr">{number}</span></h2>
          {attachment.mime_type === "application/pdf" ? (
            <p className="rounded border border-dashed border-slate-400 p-4 text-sm">
              مرفق PDF: <a href={`/api/pharmacy/attachments/${attachment.id}`} className="font-bold underline" target="_blank" rel="noopener noreferrer">{attachment.file_name}</a> — يُطبع من الرابط منفصلًا.
            </p>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element -- صورة محمية تُخدم من مسار مصادق
            <img src={`/api/pharmacy/attachments/${attachment.id}`} alt={KIND[attachment.kind ?? ""] ?? "مرفق"} className="mx-auto max-h-[240mm] w-auto max-w-full object-contain" />
          )}
        </section>
      ))}
    </div>
  );
}
