import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { getArabicSearchTerms } from "@/lib/search";
import { formatDateTripoli, formatTimeTripoli, getStartOfDayTripoli, getEndOfDayTripoli } from "@/lib/datetime";
import { BackButton } from "@/components/back-button";
import { AutoPrint } from "@/components/auto-print";

export default async function TransactionPrintPage({
  searchParams,
}: {
  searchParams: Promise<{ start_date?: string; end_date?: string; facility_id?: string; q?: string; status?: string; tx_type?: string; source?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  const { start_date, end_date, facility_id, q, source, tx_type } = await searchParams;

  const facilities = session.is_admin
    ? await prisma.facility.findMany({ where: { deleted_at: null }, select: { id: true, name: true } })
    : [{ id: session.id, name: session.name }];

  const rawFacilityFilter = (facility_id ?? "").trim();
  const selectedFacility = facilities.find((f) => f.id === rawFacilityFilter || f.name === rawFacilityFilter);
  const resolvedFacilityId = session.is_admin ? selectedFacility?.id : session.id;
  const sourceFilter = source ?? "all";

  const where: any = {};
  if (session.is_admin) {
    if (resolvedFacilityId) where.facility_id = resolvedFacilityId;
  } else {
    where.facility_id = session.id;
  }

  where.is_cancelled = false;

  const canViewSettlement = session.is_admin || session.is_manager;
  if (!canViewSettlement) {
    where.AND = [{ type: { not: "SETTLEMENT" } }];
  }

  if (session.is_admin && sourceFilter === "import") {
    where.AND = [...(where.AND || []), { type: "IMPORT" }];
  } else if (session.is_admin && sourceFilter === "manual") {
    if (!where.type) where.type = { in: ["MEDICINE", "SUPPLIES", "SETTLEMENT"] };
  }

  const txTypeFilter = tx_type ?? "all";
  if (txTypeFilter === "supplies") {
    where.AND = [...(where.AND || []), { type: "SUPPLIES" }];
  } else if (txTypeFilter === "medicine") {
    where.AND = [...(where.AND || []), { type: { in: ["MEDICINE", "IMPORT"] } }];
  }

  const searchQuery = q?.trim().slice(0, 100) ?? "";
  if (searchQuery !== "") {
    const searchOr = getArabicSearchTerms(searchQuery).flatMap(t => [
      { beneficiary: { name: { contains: t, mode: "insensitive" } } },
      { beneficiary: { card_number: { contains: t, mode: "insensitive" } } },
    ]);
    where.AND = [...(where.AND || []), { OR: searchOr }];
  }

  const hasDateFilter = !!(start_date || end_date);
  where.created_at = {};
  
  if (start_date) {
    const start = getStartOfDayTripoli(start_date);
    if (!isNaN(start.getTime())) {
      where.created_at.gte = start;
    }
  } else if (!hasDateFilter) {
    // التقصير لآخر 30 يوم حسب توقيت طرابلس
    const nowTripoli = new Date(new Date().toLocaleString("en-US", { timeZone: "Africa/Tripoli" }));
    nowTripoli.setDate(nowTripoli.getDate() - 30);
    nowTripoli.setHours(0, 0, 0, 0);
    
    // تحويل الوقت من "قيمة طرابلس في كائن التاريخ" إلى لحظة زمنية صحيحة (UTC+2)
    const dateStr = nowTripoli.toISOString().split('T')[0];
    where.created_at.gte = getStartOfDayTripoli(dateStr);
  }
  
  if (end_date) {
    const end = getEndOfDayTripoli(end_date);
    if (!isNaN(end.getTime())) {
      where.created_at.lte = end;
    }
  }

  const [transactions, totals] = await Promise.all([
    prisma.transaction.findMany({
      where,
      orderBy: { created_at: "desc" },
      select: {
        id: true,
        beneficiary_id: true,
        amount: true,
        type: true,
        is_cancelled: true,
        created_at: true,
        beneficiary: { select: { name: true, card_number: true, remaining_balance: true } },
        facility: { select: { name: true } },
      },
      take: 20000, 
    }),
    prisma.transaction.aggregate({
      where: { ...where, is_cancelled: false },
      _sum: { amount: true },
      _count: { id: true },
    }),
  ]);

  const reportTotalAmount = Number(totals._sum.amount ?? 0);
  const reportRowsCount = totals._count.id;
  const isSingleBeneficiary = transactions.length > 0 && transactions.every(t => (t as any).beneficiary_id === (transactions[0] as any).beneficiary_id);
  const reportTotalRemaining = isSingleBeneficiary ? Number(transactions[0].beneficiary?.remaining_balance ?? 0) : 0;

  const colSpan = session.is_admin ? 7 : 6;

  return (
    <div dir="rtl" style={{ backgroundColor: '#fff', color: '#000', margin: '0', padding: '0' }}>
      <style dangerouslySetInnerHTML={{ __html: `
        style { display: none !important; }
        
        @media print {
          @page { size: A4 landscape; margin: 1.5cm; } /* هوامش حقيقية لتجنب تداخل البيانات */
          html, body { 
            background: white !important; 
            margin: 0 !important; 
            padding: 0 !important; 
            height: auto !important; 
            counter-reset: page; 
          }
          .no-print { display: none !important; }
          
          #printable-report {
            visibility: visible !important;
            display: block !important;
            width: 100% !important;
            box-sizing: border-box !important;
          }
          
          table { width: 100% !important; border-collapse: collapse !important; border: 2px solid black !important; }
          th, td { border: 1px solid black !important; padding: 6px !important; color: black !important; font-size: 11px !important; }
          
          thead { display: table-header-group !important; }
          tfoot { display: table-footer-group !important; }

          #page-footer-content {
            display: block !important;
            position: fixed;
            bottom: -1cm; /* الترقيم داخل منطقة الهامش الحقيقية */
            width: 100%;
            left: 0;
            text-align: center;
            font-size: 11px;
            color: black !important;
            visibility: visible !important;
          }
          
          .page-number:after {
            counter-increment: page;
            content: "صفحة " counter(page);
          }
        }

        #page-footer-content { display: none; }
        #printable-report { visibility: visible !important; padding: 20px; }

        .main-print-table {
          width: 100%;
          border-collapse: collapse;
          border: 2px solid black;
          background: white;
          margin-top: 10px;
        }

        .main-print-table th, .main-print-table td {
          border: 1px solid black;
          padding: 8px;
          text-align: right;
          color: black;
        }
        
        .report-header { text-align: center; margin-bottom: 20px; }
        .summary-box { width: 100%; border-collapse: collapse; margin-bottom: 15px; }
        .summary-box td { border: 1px solid black; text-align: center; padding: 10px; background: #f9f9f9; }
      ` }} />

      <div id="printable-report">
        <div className="report-header">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="Logo" style={{ height: '60px', margin: '0 auto 10px', display: 'block' }} />
          <h1 style={{ fontSize: '26px', margin: '0', fontWeight: 'bold' }}>Waha Health Care</h1>
          <h2 style={{ fontSize: '20px', margin: '8px 0' }}>سجل الحركات الكامل ({session.name})</h2>
          <p style={{ fontSize: '13px', margin: '0' }}>تاريخ استخراج الكشف: {formatDateTripoli(new Date(), "en-GB")}</p>
          {session.is_admin && resolvedFacilityId && <p style={{ fontWeight: 'bold', fontSize: '14px', marginTop: '5px' }}>المرفق المختار: {selectedFacility?.name}</p>}
        </div>

        <table className="summary-box">
          <tbody>
            <tr>
              <td style={{ width: '33.33%' }}>
                 <div style={{ fontSize: '12px' }}>إجمالي الحركات</div>
                 <div style={{ fontSize: '22px', fontWeight: 'bold' }}>{reportRowsCount.toLocaleString("ar-LY")}</div>
              </td>
              <td style={{ width: '33.33%' }}>
                 <div style={{ fontSize: '12px' }}>إجمالي القيمة</div>
                 <div style={{ fontSize: '22px', fontWeight: 'bold' }}>{reportTotalAmount.toLocaleString("ar-LY")} د.ل</div>
              </td>
              <td style={{ width: '33.33%' }}>
                 <div style={{ fontSize: '12px' }}>الفترة الزمنية</div>
                 <div style={{ fontSize: '20px', fontWeight: 'bold' }}>
                    {`${start_date || "من البداية"} - ${end_date || "اليوم"}`}
                 </div>
              </td>
            </tr>
          </tbody>
        </table>

        <table className="main-print-table">
          <thead>
            <tr style={{ backgroundColor: '#eeeeee' }}>
              <th style={{ textAlign: 'center', width: '45px' }}>#</th>
              <th>المستفيد</th>
              {session.is_admin && <th>المرفق</th>}
              <th>نوع الحركة</th>
              <th style={{ textAlign: 'center' }}>القيمة</th>
              <th>التاريخ والوقت</th>
              <th style={{ textAlign: 'center' }}>الحالة</th>
            </tr>
          </thead>
          <tbody>
            {transactions.map((tx, idx) => (
              <tr key={tx.id}>
                <td style={{ textAlign: 'center' }}>{idx + 1}</td>
                <td>
                  <div style={{ fontWeight: 'bold' }}>{tx.beneficiary?.name || "غير معروف"}</div>
                  <div style={{ fontSize: '10px', color: '#333' }}>{tx.beneficiary?.card_number || "---"}</div>
                </td>
                {session.is_admin && <td>{tx.facility?.name || "---"}</td>}
                <td>
                  {tx.type === "MEDICINE" || tx.type === "IMPORT" ? "ادوية صرف عام" : tx.type === "SETTLEMENT" ? "تسوية" : "كشف عام"}
                </td>
                <td style={{ textAlign: 'center', fontWeight: 'bold' }}>
                  {Number(tx.amount || 0).toLocaleString("ar-LY")} د.ل
                </td>
                <td>
                   {formatDateTripoli(tx.created_at, "en-GB")} {formatTimeTripoli(tx.created_at, "ar-LY")}
                </td>
                <td style={{ textAlign: 'center' }}>
                  {tx.is_cancelled ? "ملغاة" : "منفذة"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div id="page-footer-content">
          <span className="page-number"></span>
        </div>
      </div>

      <AutoPrint delay={1500} />
      
      <div className="no-print" style={{ marginTop: '30px', textAlign: 'center' }}>
        <BackButton />
      </div>
    </div>
  );
}
