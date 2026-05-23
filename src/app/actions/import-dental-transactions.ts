"use server";

import prisma from "@/lib/prisma";
import ExcelJS from "exceljs";
import { requireActiveFacilitySession } from "@/lib/session-guard";
import { logger } from "@/lib/logger";
import { InsuranceEngine } from "@/lib/insurance/engine";
import { revalidatePath } from "next/cache";

export type SkippedRowDetail = {
  rowNumber: number;
  name: string;
  card: string;
  facilityName: string;
  amount: number;
  reason: string;
};

export type SummaryGroup = {
  companyName: string;
  facilityName: string;
  count: number;
  totalAmount: number;
  isMatched: boolean;
  reason?: string;
};

export type ImportResult = {
  success: boolean;
  error?: string;
  totalRows: number;
  insertedCount: number;
  skippedCount: number;
  skippedDetails: SkippedRowDetail[];
  groups: SummaryGroup[];
};

const FACILITY_MAP: Record<string, string> = {
  "الليبية التخصصية": "cmn78k17t0034nz1nkwiklngp",
  "الليبية التخصصية - اسنان": "cmn78k17t0034nz1nkwiklngp",
  "الليبية التخصصيه": "cmn78k17t0034nz1nkwiklngp",
  "الليبيه التخصصيه": "cmn78k17t0034nz1nkwiklngp",
  "الليبيه التخصيصيه": "cmn78k17t0034nz1nkwiklngp",
  "فينيسيا": "cmn78k17t0035nz1n3t9j6iey",
  "مركز فينيسيا - اسنان": "cmn78k17t0035nz1n3t9j6iey",
  "مستشفى فينيسيا": "cmn78k17t0035nz1n3t9j6iey",
  "فنيسيا": "cmn78k17t0035nz1n3t9j6iey",
  "عيادة الابتسامه": "cmn78k17t0033nz1n8kwgcf2i",
  "الابتسامه": "cmn78k17t0033nz1n8kwgcf2i",
  "الابتسامة": "cmn78k17t0033nz1n8kwgcf2i",
  "الايتسامة": "cmn78k17t0033nz1n8kwgcf2i",
  "مركز الابتسامة  - اسنان": "cmn78k17t0033nz1n8kwgcf2i",
  "مركز الابتسامه": "cmn78k17t0033nz1n8kwgcf2i",
  "مركز قيس": "cmnovn0z9059vpm0o6024iq09",
  "مركز قيس للاسنان": "cmnovn0z9059vpm0o6024iq09",
  "القيس": "cmnovn0z9059vpm0o6024iq09",
  "الامل": "cmn78k17t0032nz1nbcu8a0jr",
  "مركز الامل": "cmn78k17t0032nz1nbcu8a0jr",
  "مركز الامل - اسنان": "cmn78k17t0032nz1nbcu8a0jr",
  "الريادة": "cmnfobmdu0asrpm0o2phplk8v",
  "مركز الريادة": "cmnfobmdu0asrpm0o2phplk8v",
  "مركز الريادة للاسنان": "cmnfobmdu0asrpm0o2phplk8v",
  "الرياده": "cmnfobmdu0asrpm0o2phplk8v",
  "التيجان": "cmn78k17t003hnz1niuni1ruy",
  "تيجان": "cmn78k17t003hnz1niuni1ruy",
  "الهلال الاحمر - البركة": "cmn4pktb8000cn82k834igzmj",
  "دينتال": "cmn78k17t003gnz1nguqwjd8n",
  "مركز الحياة": "cmn4pktb9003on82kw9kzwrgo",
  "مركز درنه": "cmn78k17t003fnz1ntwonox2n",
  "مصحة الاستشاري": "cmn4pktb9002ln82kk9hadztc",
  "مصحة الحكمة": "cmn4pktb90042n82kqob8niyt",
  "نبض الحياه": "cmn4pktb9004bn82kbp7iafvl"
};

function normalizeCardNumber(card: any): string {
  if (!card) return "";
  return String(card).trim().toUpperCase();
}

function parseExcelDate(val: any): Date {
  if (!val) return new Date();
  
  // 1. If ExcelJS parsed it as a Date object directly
  if (val instanceof Date && !isNaN(val.getTime())) {
    return val;
  }
  
  // 2. If it's an object (like formula result or cell object)
  if (typeof val === "object") {
    if (val.result instanceof Date && !isNaN(val.result.getTime())) {
      return val.result;
    }
    if (val.result !== undefined && val.result !== null) {
      val = val.result;
    } else if (val.text !== undefined && val.text !== null) {
      val = val.text;
    } else if (val.value !== undefined && val.value !== null) {
      val = val.value;
    }
  }

  // 3. If it's a number (Excel date serial number)
  if (typeof val === "number" && !isNaN(val)) {
    // Excel date serial number (e.g. 45392 represents a date in 2024)
    // 25569 is the number of days between 1900-01-01 and 1970-01-01
    const date = new Date((val - 25569) * 86400 * 1000);
    if (!isNaN(date.getTime())) {
      return date;
    }
  }

  // 4. If it's a string
  if (typeof val === "string") {
    const cleaned = val.trim();
    if (!cleaned) return new Date();

    // Check DD/MM/YYYY or D/M/YYYY or with dashes
    const slashMatch = cleaned.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (slashMatch) {
      const day = parseInt(slashMatch[1], 10);
      const month = parseInt(slashMatch[2], 10) - 1; // 0-indexed
      const year = parseInt(slashMatch[3], 10);
      const d = new Date(year, month, day);
      if (!isNaN(d.getTime())) return d;
    }

    // Check YYYY/MM/DD or YYYY-MM-DD
    const isoMatch = cleaned.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
    if (isoMatch) {
      const year = parseInt(isoMatch[1], 10);
      const month = parseInt(isoMatch[2], 10) - 1; // 0-indexed
      const day = parseInt(isoMatch[3], 10);
      const d = new Date(year, month, day);
      if (!isNaN(d.getTime())) return d;
    }

    // Try native JS Date parser
    const parsed = new Date(cleaned);
    if (!isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  return new Date();
}

export async function importDentalTransactionsAction(
  fileBase64: string,
  purgeOld: boolean,
  dryRun: boolean,
  companyId?: string
): Promise<ImportResult> {
  const session = await requireActiveFacilitySession();
  if (!session || !session.is_admin) {
    return { success: false, error: "غير مصرح — مخصص للمشرفين فقط", totalRows: 0, insertedCount: 0, skippedCount: 0, skippedDetails: [], groups: [] };
  }

  try {
    const buffer = Buffer.from(fileBase64, "base64");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as any);
    const ws = workbook.getWorksheet(1) || workbook.worksheets[0];
    if (!ws) {
      return { success: false, error: "ملف Excel فارغ أو لا يحتوي على ورقة عمل صالحة.", totalRows: 0, insertedCount: 0, skippedCount: 0, skippedDetails: [], groups: [] };
    }

    const rawRows: any[] = [];
    ws.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return; // Header row

      const nameVal = row.getCell(1).value;
      const cardVal = row.getCell(2).value;
      const approvalVal = row.getCell(3).value;
      const amountVal = row.getCell(4).value;
      const dateVal = row.getCell(5).value;
      const notesVal = row.getCell(6).value;
      const facilityVal = row.getCell(7).value;

      const card = normalizeCardNumber(cardVal);
      const name = nameVal ? String(nameVal).trim() : "";
      const amount = Number(amountVal || 0);

      // Skip completely empty rows
      if (!card && !name && amount === 0) return;

      rawRows.push({
        rowNumber,
        name,
        card,
        approval: approvalVal ? String(approvalVal).trim() : "",
        amount,
        date: parseExcelDate(dateVal),
        notes: notesVal ? String(notesVal).trim() : "",
        facilityName: facilityVal ? String(facilityVal).trim() : "",
      });
    });

    const totalRows = rawRows.length;
    if (totalRows === 0) {
      return { success: false, error: "لم يتم العثور على أي حركات صالحة في الملف.", totalRows: 0, insertedCount: 0, skippedCount: 0, skippedDetails: [], groups: [] };
    }

    // Sort chronologically by date
    rawRows.sort((a, b) => a.date.getTime() - b.date.getTime());

    // Gather unique card numbers to match beneficiaries
    const uniqueCards = Array.from(new Set(rawRows.map((r) => r.card).filter(Boolean)));
    
    const dbBeneficiaries = await prisma.beneficiary.findMany({
      where: {
        deleted_at: null,
        ...(companyId 
          ? { company_id: companyId } 
          : {
              OR: uniqueCards.flatMap(c => {
                const base = c.replace(/[^A-Z0-9]/gi, "").slice(0, 10);
                if (base.length < 5) return [{ card_number: c }];
                return [
                  { card_number: { startsWith: base, mode: "insensitive" } },
                  { card_number: { mode: "insensitive", equals: c } }
                ];
              })
            }
        ),
      },
      select: {
        id: true,
        card_number: true,
        name: true,
        company_id: true,
        company: {
          select: {
            id: true,
            name: true,
          }
        }
      },
    });

    const resolveBeneficiary = (excelCard: string, excelName: string) => {
      if (!excelCard) return null;
      
      const normExcelCard = excelCard.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
      const cleanExcelName = excelName.trim().replace(/\s+/g, " ");

      // Helper to calculate name similarity
      const nameMatch = (dbName: string, exName: string) => {
        const cleanDb = dbName.trim().replace(/\s+/g, " ");
        if (cleanDb === exName) return 1.0;
        if (cleanDb.includes(exName) || exName.includes(cleanDb)) return 0.8;
        
        const dbWords = cleanDb.split(" ").filter(Boolean);
        const exWords = exName.split(" ").filter(Boolean);
        const intersection = dbWords.filter(w => exWords.includes(w));
        if (intersection.length >= 2) return 0.6;
        
        return 0.0;
      };

      // 1. Exact case-insensitive card match
      const exactMatch = dbBeneficiaries.find(b => 
        b.card_number.trim().toUpperCase().replace(/[^A-Z0-9]/g, "") === normExcelCard
      );
      if (exactMatch) return exactMatch;

      // 2. Base card match with name matching
      const getBase = (c: string) => c.replace(/[MFWSD]?\d+$/, "").replace(/[MFWSD]$/, "");
      const excelBase = getBase(normExcelCard);

      const baseCandidates = dbBeneficiaries.filter(b => {
        const dbNorm = b.card_number.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
        return getBase(dbNorm) === excelBase || dbNorm.startsWith(excelBase) || excelBase.startsWith(getBase(dbNorm));
      });

      if (baseCandidates.length > 0) {
        if (baseCandidates.length === 1) return baseCandidates[0];

        let bestCandidate = null;
        let highestScore = 0;
        for (const candidate of baseCandidates) {
          const score = nameMatch(candidate.name, cleanExcelName);
          if (score > highestScore) {
            highestScore = score;
            bestCandidate = candidate;
          }
        }
        if (bestCandidate && highestScore > 0) {
          return bestCandidate;
        }
        return baseCandidates[0];
      }

      // 3. Fallback name match if unique
      const nameCandidates = dbBeneficiaries.filter(b => nameMatch(b.name, cleanExcelName) >= 0.8);
      if (nameCandidates.length === 1) {
        return nameCandidates[0];
      }

      return null;
    };

    // Get list of facilities to match
    const dbFacilities = await prisma.facility.findMany({
      where: { deleted_at: null },
      select: { id: true, name: true },
    });

    // Match helper
    const resolveFacility = (name: string): { id: string; name: string } | null => {
      if (!name) return null;
      const clean = name.trim();
      
      // 1. Check custom map
      const mappedId = FACILITY_MAP[clean];
      if (mappedId) {
        const found = dbFacilities.find(f => f.id === mappedId);
        if (found) return found;
      }

      // 2. Exact match
      const exact = dbFacilities.find(f => f.name === clean);
      if (exact) return exact;

      // 3. Loose match
      const cleanLower = clean.replace(/\s+/g, "").toLowerCase();
      const loose = dbFacilities.find(f => {
        const cleanDb = f.name.replace(/\s+/g, "").toLowerCase();
        return cleanDb.includes(cleanLower) || cleanLower.includes(cleanDb);
      });
      return loose || null;
    };

    // Policy cache
    const companyIds = Array.from(
      new Set(dbBeneficiaries.map((b) => b.company_id).filter(Boolean))
    ) as string[];

    const dbCompanies = await prisma.insuranceCompany.findMany({
      where: {
        id: { in: companyIds },
        is_active: true,
        deleted_at: null,
      },
    });

    const policyMap = new Map(
      dbCompanies.map((c) => [
        c.id,
        {
          service_type: "DENTAL",
          annual_ceiling: c.dental_ceiling,
          copay_percentage: Math.max(0, 100 - Number(c.dental_coverage)),
          allow_partial_coverage: true,
        }
      ])
    );

    // Grouping variables for preview stats
    // Key: companyName + ":::" + facilityName
    const groupStats = new Map<string, { count: number; totalAmount: number; isMatched: boolean; reason?: string }>();

    const skippedDetails: SkippedRowDetail[] = [];
    let insertedCount = 0;
    let skippedCount = 0;

    // Running consumption cache
    const runningConsumption = new Map<string, number>();

    // If not dry-run and purgeOld is true, execute purge first
    if (!dryRun && purgeOld) {
      await prisma.transaction.deleteMany({
        where: {
          type: "DENTAL",
          ...(companyId ? { company_id: companyId } : {}),
        }
      });
      logger.info("Purged previous dental transactions as requested.");
    }

    // Process rows
    for (const r of rawRows) {
      const facility = resolveFacility(r.facilityName);
      const beneficiary = r.card ? resolveBeneficiary(r.card, r.name) : null;
      const companyName = beneficiary?.company?.name || "شركة غير مطابقة أو غير معروفة";
      const resolvedFacilityName = facility?.name || r.facilityName || "مرفق غير معروف";

      const groupKey = `${companyName}:::${resolvedFacilityName}`;
      if (!groupStats.has(groupKey)) {
        let isMatched = true;
        let reason = "";
        if (!beneficiary) {
          isMatched = false;
          reason = "المستفيد غير موجود";
        } else if (!facility) {
          isMatched = false;
          reason = "المرفق غير مطابق";
        }
        groupStats.set(groupKey, { count: 0, totalAmount: 0, isMatched, reason });
      }

      const stats = groupStats.get(groupKey)!;
      stats.count++;
      stats.totalAmount += r.amount;

      // Validation check
      if (!r.card) {
        skippedCount++;
        skippedDetails.push({
          rowNumber: r.rowNumber,
          name: r.name,
          card: "",
          facilityName: r.facilityName,
          amount: r.amount,
          reason: "رقم التأمين فارغ",
        });
        continue;
      }

      if (!beneficiary) {
        // التحقق مما إذا كان المستفيد موجوداً تحت شركة أخرى لإظهار رسالة توضيحية دقيقة
        const otherBen = r.card 
          ? await prisma.beneficiary.findFirst({
              where: {
                card_number: { mode: "insensitive", startsWith: r.card.replace(/[^A-Z0-9]/gi, "").slice(0, 12) },
                deleted_at: null
              },
              include: { company: true }
            })
          : null;

        skippedCount++;
        skippedDetails.push({
          rowNumber: r.rowNumber,
          name: r.name,
          card: r.card,
          facilityName: r.facilityName,
          amount: r.amount,
          reason: otherBen 
            ? `المستفيد تابع لشركة أخرى (${otherBen.company?.name || "بدون اسم"}) وليس الشركة المحددة`
            : "المستفيد غير موجود بقاعدة البيانات",
        });
        continue;
      }

      if (!facility) {
        skippedCount++;
        skippedDetails.push({
          rowNumber: r.rowNumber,
          name: r.name,
          card: r.card,
          facilityName: r.facilityName,
          amount: r.amount,
          reason: `المرفق الصحي (${r.facilityName}) غير معروف أو غير مطابق في المنظومة`,
        });
        continue;
      }

      if (dryRun) {
        // If it's a dry-run, we skip DB write but count it as "to be inserted"
        insertedCount++;
        continue;
      }

      // Chronological consumption tracking
      const year = r.date.getFullYear();
      const consumptionKey = `${beneficiary.id}:${year}`;

      if (!runningConsumption.has(consumptionKey)) {
        const startDate = new Date(year, 0, 1);
        const agg = await prisma.transaction.aggregate({
          where: {
            beneficiary_id: beneficiary.id,
            type: "DENTAL",
            is_cancelled: false,
            created_at: { gte: startDate, lt: r.date },
          },
          _sum: { ceiling_consumed: true },
        });
        runningConsumption.set(consumptionKey, Number(agg._sum.ceiling_consumed ?? 0));
      }

      const currentConsumed = runningConsumption.get(consumptionKey) || 0;
      const policy = beneficiary.company_id ? policyMap.get(beneficiary.company_id) : null;

      let tpaData: any = {};
      if (policy) {
        const effectiveCeiling = (policy.annual_ceiling === null || Number(policy.annual_ceiling) === 0)
          ? null : Number(policy.annual_ceiling);

        const calcResult = InsuranceEngine.calculate({
          amount: r.amount,
          consumedThisYear: currentConsumed,
          policy: {
            serviceType: "DENTAL",
            annualCeiling: effectiveCeiling,
            copayPercentage: Number(policy.copay_percentage),
            allowPartialCoverage: policy.allow_partial_coverage,
          },
        });

        tpaData = {
          company_id: beneficiary.company_id,
          service_category: "DENTAL",
          original_company_share: calcResult.originalCompanyShare,
          original_patient_share: calcResult.originalPatientShare,
          actual_company_share: calcResult.actualCompanyShare,
          actual_patient_share: calcResult.actualPatientShare,
          remaining_ceiling_before: calcResult.remainingCeilingBefore,
          ceiling_consumed: calcResult.ceilingConsumed,
          remaining_ceiling_after: calcResult.remainingCeilingAfter,
          consumed_before: calcResult.consumedBefore,
          consumed_after: calcResult.consumedAfter,
          policy_snapshot: JSON.parse(JSON.stringify(policy)),
          calc_metadata: {
            ...(calcResult.metadata || {}),
            notes: r.notes || `استيراد حركة سابقة - موافقة ${r.approval || "بدون"}`,
          },
        };

        runningConsumption.set(consumptionKey, currentConsumed + Number(calcResult.ceilingConsumed));
      } else {
        tpaData = {
          company_id: beneficiary.company_id,
          service_category: "DENTAL",
          calc_metadata: { 
            tpaApplied: false, 
            reason: "no_policy",
            notes: r.notes || `استيراد حركة سابقة - موافقة ${r.approval || "بدون"}`,
          },
        };
      }

      const dateStr = r.date.toISOString().slice(0, 10);
      const idempotencyKey = `import-dental-tx:${r.rowNumber}:${r.card}:${r.amount}:${dateStr}`;

      const existing = await prisma.transaction.findUnique({
        where: { idempotency_key: idempotencyKey },
      });

      if (existing) {
        skippedCount++;
        skippedDetails.push({
          rowNumber: r.rowNumber,
          name: r.name,
          card: r.card,
          facilityName: r.facilityName,
          amount: r.amount,
          reason: "تم استيراد هذه الحركة مسبقاً (مكررة)",
        });
        continue;
      }

      await prisma.transaction.create({
        data: {
          beneficiary_id: beneficiary.id,
          facility_id: facility.id,
          amount: r.amount,
          type: "DENTAL",
          is_cancelled: false,
          created_at: r.date,
          idempotency_key: idempotencyKey,
          ...tpaData,
        },
      });

      insertedCount++;
    }

    // Convert map to groups array
    const groups: SummaryGroup[] = Array.from(groupStats.entries()).map(([key, value]) => {
      const [companyName, facilityName] = key.split(":::");
      return {
        companyName,
        facilityName,
        count: value.count,
        totalAmount: value.totalAmount,
        isMatched: value.isMatched,
        reason: value.reason,
      };
    });

    if (!dryRun) {
      revalidatePath("/admin/dental-transactions");
    }

    return {
      success: true,
      totalRows,
      insertedCount,
      skippedCount,
      skippedDetails,
      groups,
    };
  } catch (error: any) {
    logger.error("Dental transactions import action error", { error: String(error) });
    return {
      success: false,
      error: error.message || "حدث خطأ غير متوقع أثناء معالجة الاستيراد.",
      totalRows: 0,
      insertedCount: 0,
      skippedCount: 0,
      skippedDetails: [],
      groups: [],
    };
  }
}
