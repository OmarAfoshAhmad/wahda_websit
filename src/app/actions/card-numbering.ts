"use server";

import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import type { CardNumberingStatus } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { hasPermission } from "@/lib/session-guard";

export type CardNumberingItem = {
  name: string;
  employee_number: string;
  relationship?: string; 
  birth_date?: string;   
  original_date?: string; // التاريخ الأصلي من الملف
  city?: string;         // المدينة
  batch_number?: string; // رقم الدفعة
  status?: string;       
  field3?: string;
  error_message?: string; // رسالة الخطأ
};

// رموز اللاحقة للعائلة شاملة الأخطاء الإملائية وال التعريف والهمزات والتاء المربوطة
const RELATIONSHIP_CODE_MAP: Record<string, string> = {
  // الزوجة
  "زوجة": "W", "زوجه": "W", "الزوجة": "W", "الزوجه": "W", "حرم": "W", "حرمه": "W", "زوجته": "W",
  // الزوج
  "زوج": "H", "الزوج": "H", "زوجهما": "H",
  // الابن
  "ابن": "S", "الابن": "S", "إبن": "S", "الإبن": "S", "أبن": "S", "الأبن": "S", "ولد": "S", "الولد": "S", "ولده": "S", "نجل": "S", "النجل": "S", // "ابنه" تم نقلها للابنة
  // الابنة
  "ابنة": "D", "الابنة": "D", "إبنة": "D", "الإبنة": "D", "أبنة": "D", "الأبنة": "D", "ابنته": "D", "بنته": "D", "بنت": "D", "البنت": "D", "كريمة": "D", "الكريمة": "D", "كريمه": "D", "الكريمه": "D", "كريمته": "D", "ابنه": "D", "الابنه": "D", "إبنه": "D", "الإبنه": "D", "أبنه": "D", "الأبنه": "D", "ابه": "D",
  // الأم
  "أم": "M", "ام": "M", "الأم": "M", "الام": "M", "والدة": "M", "والده": "M", "الوالدة": "M", "الوالده": "M", "والدته": "M", "أمه": "M", "امه": "M", "الامه": "M",
  // الأب
  "أب": "F", "اب": "F", "الأب": "F", "الاب": "F", "والد": "F", "الوالد": "F", "والدي": "F", "أبيه": "F", "ابيه": "F",
  // اللغات الأجنبية
  "W": "W", "S": "S", "D": "D", "M": "M", "F": "F", "H": "H"
};

// المصطلحات التي تدل على أن المستفيد هو الموظف أو الحساب الرئيسي شاملة جميع الاحتمالات
const MAIN_ACCOUNT_TERMS = [
  "موظف", "موظفة", "الموظف", "الموظفة", "موظفه", "الموظفه",
  "رب الأسرة", "رب العائلة", "رب أسرة", "رب عائلة", "رب الاسرة", "رب الاسره", "رب العائله", "الاب", "الأب",
  "صاحب البطاقة", "رئيسي", "الرئيسي", "الرئيسية", "الرئيسيه",
  "MAIN", "EMPLOYEE",
  "متوفي", "متوفى", "وفاة", "حالة وفاة",
  "ملحق", "ملحقة", "ملحقه", "الملحق", "الملحقة"
];

const getRelRank = (rel: string) => {
  const r = String(rel || "").trim().toLowerCase();
  if (!r || MAIN_ACCOUNT_TERMS.includes(r) || r === "employee") return 1;
  if (["أب", "اب", "الأب", "الاب", "والد", "الوالد"].includes(r)) return 2;
  if (["أم", "ام", "الأم", "الام", "والدة", "والده", "الوالدة", "الوالده"].includes(r)) return 3;
  if (["زوجة", "زوجه", "الزوجة", "الزوجه", "زوج", "الزوج"].includes(r)) return 4;
  if (["ابن", "الابن", "إبن", "الإبن", "ولد", "الولد"].includes(r)) return 5;
  if (["ابنة", "الابنة", "ابنه", "الابنه", "بنت", "البنت", "ابنته", "كريمة", "الكريمة"].includes(r)) return 6;
  return 7;
};

// دالة لحساب نسبة التطابق بين التاريخ الأصلي والمحسوب
const calculateMatchPercentage = (originalDate: string | undefined, calculatedDate: string | undefined): { percentage: number; mismatches: string[] } => {
  const mismatches: string[] = [];
  let matchScore = 100;

  if (!originalDate || !calculatedDate) {
    if (!originalDate && !calculatedDate) {
      return { percentage: 100, mismatches: [] };
    }
    return { percentage: 0, mismatches: ["أحد التاريخين مفقود"] };
  }

  // استخراج أجزاء التاريخ
  const original = originalDate.trim();
  const calculated = calculatedDate.trim();

  if (original === calculated) {
    return { percentage: 100, mismatches: [] };
  }

  // محاولة مطابقة الأجزاء
  const origParts = original.split(/[-\/]/).filter(p => p);
  const calcParts = calculated.split(/[-\/]/).filter(p => p);

  if (origParts.length > 0 && calcParts.length > 0) {
    // السنة
    if (origParts[0] !== calcParts[0]) {
      mismatches.push("السنة مختلفة");
      matchScore -= 40;
    }
    // الشهر
    if (origParts[1] && calcParts[1] && origParts[1] !== calcParts[1]) {
      mismatches.push("الشهر مختلف");
      matchScore -= 30;
    }
    // اليوم
    if (origParts[2] && calcParts[2] && origParts[2] !== calcParts[2]) {
      mismatches.push("اليوم مختلف");
      matchScore -= 30;
    }
  }

  return { 
    percentage: Math.max(0, matchScore), 
    mismatches 
  };
};

export async function getCardNumberingArchive(showDeleted: boolean = false) {
  const session = await getSession();
  if (!session || (!hasPermission(session, "manage_card_numbering") && !hasPermission(session, "migrate_card_numbering"))) return { error: "غير مصرح" };

  try {
    const items = await prisma.cardNumberingArchive.findMany({
      where: {
        deleted_at: showDeleted ? { not: null } : null
      },
      orderBy: [
        { created_at: "desc" }
      ],
    });
    return {
      items: items.map(item => ({
        ...item,
        created_at: item.created_at.toISOString(),
        migrated_at: item.migrated_at?.toISOString() || null,
        birth_date: item.birth_date ? `${item.birth_date.getUTCFullYear()}-${String(item.birth_date.getUTCMonth() + 1).padStart(2, '0')}-${String(item.birth_date.getUTCDate()).padStart(2, '0')}` : null,
      }))
    };
  } catch (error) {
    return { error: "تعذر جلب الأرشيف" };
  }
}

const normalizeArabicText = (text: string): string => {
  return text
    .trim()
    .toLowerCase()
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/\s+/g, " ");
};

export async function importCardNumberingAction(data: CardNumberingItem[], options: { prefix: string, padding: number, sourceFile?: string, city?: string, batchNumber?: string }) {
  const session = await getSession();
  if (!session || !hasPermission(session, "manage_card_numbering")) return { error: "غير مصرح" };

  try {
    const { prefix = "WAB2025", padding = 0, sourceFile = "يدوي", city: manualCity, batchNumber: manualBatch } = options;

    // --- فرز البيانات لضمان ترقيم صحيح حسب العمر داخل العائلة ---
    const empOrder = new Map();
    data.forEach((item, index) => {
      if (!empOrder.has(item.employee_number)) empOrder.set(item.employee_number, index);
    });

    data.sort((a, b) => {
      const orderA = empOrder.get(a.employee_number);
      const orderB = empOrder.get(b.employee_number);
      if (orderA !== orderB) return orderA - orderB;
      
      const rankA = getRelRank(a.relationship || "");
      const rankB = getRelRank(b.relationship || "");
      if (rankA !== rankB) return rankA - rankB;
      
      if (a.birth_date && b.birth_date) {
        const dateA = new Date(a.birth_date).getTime();
        const dateB = new Date(b.birth_date).getTime();
        if (!isNaN(dateA) && !isNaN(dateB)) return dateA - dateB;
      }
      return 0;
    });
    const report = { total: data.length, ready: 0, duplicate: 0, error: 0, excluded: 0, excludedItems: [] as CardNumberingItem[] };
    const countsPerEmp = new Map<string, number>();
    const seenInBatch = new Set<string>();

    // جلب كل المستفيدين الحاليين في النظام وأرشيف الترقيم لتسريع التحقق ومتابعة الترقيم
    const employeeNumbers = Array.from(
      new Set(data.map(item => String(item.employee_number || "").trim().replace(/^0+/, "")))
    ).filter(Boolean);

    // تحديد الشركة المستهدفة بناء على البادئة لتجنب مقارنة المستفيدين مع شركات أخرى (مثل مصرف الوحدة)
    const companies = await prisma.insuranceCompany.findMany({
      where: { deleted_at: null }
    });
    const sortedCompanies = [...companies].sort((a, b) => b.code.length - a.code.length);
    let targetCompany = null;
    for (const cmp of sortedCompanies) {
      if (prefix.toLowerCase().startsWith(cmp.code.toLowerCase())) {
        targetCompany = cmp;
        break;
      }
    }
    const prefixFilter = targetCompany ? targetCompany.code : prefix.substring(0, 3);

    // Helper functions for matching
    const cleanName = (n: string) => normalizeArabicText(n || "");
    const stripSpaces = (n: string) => cleanName(n).replace(/\s+/g, "");
    const getFirstName = (n: string) => cleanName(n).split(" ")[0] || "";
    const isSameDate = (d1: any, d2: any) => {
      if (!d1 || !d2) return false;
      return new Date(d1).toISOString().split('T')[0] === new Date(d2).toISOString().split('T')[0];
    };

    // البحث في النظام (مع تقييد البحث بالشركة المستهدفة فقط)
    const existingSystemBens = await prisma.beneficiary.findMany({
      where: {
        OR: employeeNumbers.map(emp => ({
          card_number: { contains: emp }
        })),
        AND: targetCompany ? [
          {
            OR: [
              { company_id: targetCompany.id },
              { card_number: { startsWith: prefixFilter, mode: "insensitive" } }
            ]
          }
        ] : [],
        deleted_at: null
      },
      select: { card_number: true, name: true, is_legacy_card: true, birth_date: true }
    });

    // البحث في الأرشيف (مع تقييد البحث ببادئة الشركة المستهدفة فقط)
    const existingArchiveItems = await prisma.cardNumberingArchive.findMany({
      where: {
        employee_number: { in: employeeNumbers },
        card_number: { startsWith: prefixFilter },
        deleted_at: null
      },
      select: { card_number: true, name: true, status: true, employee_number: true, birth_date: true }
    });

    const baseTime = Date.now();
    let loopIndex = 0;
    for (const item of data) {
      loopIndex++;
      const empNumRaw = String(item.employee_number || "").trim();
      const empNum = empNumRaw.replace(/^0+/, "");
      const name = String(item.name || "").trim();
      const statusVal = String(item.status || "").trim();
      const relVal = String(item.relationship || "").trim();
      const notesVal = String(item.field3 || "").trim();

      const fullTextSearch = `${statusVal} ${name} ${relVal} ${notesVal}`.toLowerCase();
      const isDeceased = fullTextSearch.includes("متوفي") || fullTextSearch.includes("متوفى") || fullTextSearch.includes("وفاة");
      const isAppendix = fullTextSearch.includes("ملحق");
      const existingInSystemFast = existingSystemBens.find(b => 
        b.card_number.toLowerCase().replace(/[wsdmfh]\d*$/i, "").endsWith(empNum.toLowerCase()) &&
        normalizeArabicText(b.name) === normalizeArabicText(name)
      );
      const hasOldCard = existingInSystemFast?.is_legacy_card || false;

      const birthDateVal = String(item.birth_date || "").trim();
      const isMissingBirthDate = !birthDateVal;

      let status: CardNumberingStatus = "READY";
      let errorMsg: string | null = null;

      if (hasOldCard) {
        errorMsg = "ملاحظة: يحمل بطاقة قديمة";
      }

      if (!empNum || !name) {
        status = "ERROR";
        errorMsg = "الاسم والرقم الوظيفي مطلوبان" + (hasOldCard ? " - يحمل بطاقة قديمة" : "");
        report.error++;
      } else if (isDeceased) {
        status = "ERROR";
        errorMsg = "متوفي" + (hasOldCard ? " - يحمل بطاقة قديمة" : "");
        report.excluded++;
        report.excludedItems.push({ ...item, error_message: errorMsg } as CardNumberingItem);
      } else if (isAppendix) {
        status = "ERROR";
        errorMsg = "ملحق" + (hasOldCard ? " - يحمل بطاقة قديمة" : "");
        report.excluded++;
        report.excludedItems.push({ ...item, error_message: errorMsg } as CardNumberingItem);
      }

      const baseCard = prefix + (padding > 0 ? empNum.padStart(padding, "0") : empNum);
      let rel = String(item.relationship || "").trim();
      const isMain = !rel || MAIN_ACCOUNT_TERMS.includes(rel) || rel.toLowerCase() === "employee";

      let finalCardNumber = baseCard;

      if (empNum && name) {
        // العثور على البادئة (رقم بطاقة الموظف الرئيسي) الموجودة بالفعل في المنظومة أو الأرشيف
        let matchedBaseCard = baseCard;
        // Use regex to allow any number of zeros for padding
        const expectedPattern = new RegExp(`^${prefix}0*${empNum}$`, "i");
        
        const existingMainSystem = existingSystemBens.find(b => {
          const cardLower = b.card_number.toLowerCase();
          const stripped = cardLower.replace(/[wsdmfh]\d*$/i, "");
          return expectedPattern.test(stripped) && stripped === cardLower;
        });
        const existingMainArchive = existingArchiveItems.find(a => {
          const cardLower = a.card_number.toLowerCase();
          const stripped = cardLower.replace(/[wsdmfh]\d*$/i, "");
          return expectedPattern.test(stripped) && stripped === cardLower;
        });
        // Check if the system card is actually a legacy card (either flagged, or completely unpadded)
        const isLegacySystemCard = existingMainSystem?.is_legacy_card || (
          existingMainSystem && 
          !existingMainSystem.card_number.toLowerCase().replace(/[wsdmfh]\d*$/i, "").match(new RegExp(`^${prefix.toLowerCase()}0+`))
        );

        if (existingMainSystem && !isLegacySystemCard) {
          matchedBaseCard = existingMainSystem.card_number;
        } else if (existingMainArchive) {
          matchedBaseCard = existingMainArchive.card_number;
        }

        if (isMain) {
          finalCardNumber = matchedBaseCard;
        } else {
          // الخوارزمية المتقدمة للمطابقة متعددة الطبقات (Multi-Layer Matching)
          const relCode = RELATIONSHIP_CODE_MAP[rel] || "X";

          const checkMatch = (dbName: string, dbDate: any, dbCard: string) => {
            // المستوى الأول: التطابق التام
            if (cleanName(dbName) === cleanName(name)) return true;
            // المستوى الثاني: التطابق التام بدون مسافات
            if (stripSpaces(dbName) === stripSpaces(name)) return true;
            // المستوى الثالث: الاسم الأول وتاريخ الميلاد
            if (getFirstName(dbName) === getFirstName(name) && isSameDate(dbDate, item.birth_date)) return true;
            // المستوى الرابع: الاسم الأول وصلة القرابة (باستخدام رقم البطاقة)
            // هذا ينطبق فقط إذا كانت صلة القرابة المكتوبة في الإكسيل قد تم تحويلها لنفس الحرف في المنظومة (مثل M للام)
            // ويشترط أن يكون هذا الحرف الوحيد أو المطابق تماماً للاسم الأول
            if (getFirstName(dbName) === getFirstName(name) && dbCard.toLowerCase().replace(/\d+$/, "").endsWith(relCode.toLowerCase())) return true;
            
            return false;
          };

          const systemMatch = existingSystemBens.find(b => 
            b.card_number.toLowerCase().replace(/[wsdmfh]\d*$/i, "").endsWith(empNum.toLowerCase()) &&
            checkMatch(b.name, b.birth_date, b.card_number)
          );

          const archiveMatch = existingArchiveItems.find(a => 
            a.employee_number.toLowerCase() === empNum.toLowerCase() &&
            a.card_number.toLowerCase().startsWith(baseCard.toLowerCase()) &&
            checkMatch(a.name, a.birth_date, a.card_number)
          );

          if (systemMatch && !systemMatch.is_legacy_card) {
            finalCardNumber = systemMatch.card_number;
          } else if (archiveMatch) {
            finalCardNumber = archiveMatch.card_number;
          } else {
            // توليد لاحقة جديدة
            const relCode = RELATIONSHIP_CODE_MAP[rel] || "X";
            const relCountKey = `rel_${empNum}_${relCode}`;

            if (!countsPerEmp.has(relCountKey)) {
              let maxSuffix = 0;
              const prefixToMatch = (matchedBaseCard + relCode).toLowerCase();

              existingSystemBens.forEach(b => {
                const cardLower = b.card_number.toLowerCase();
                if (cardLower.startsWith(prefixToMatch)) {
                  const suffixStr = cardLower.substring(prefixToMatch.length);
                  const suffixNum = parseInt(suffixStr, 10);
                  if (!isNaN(suffixNum) && suffixNum > maxSuffix) {
                    maxSuffix = suffixNum;
                  }
                }
              });

              existingArchiveItems.forEach(a => {
                const cardLower = a.card_number.toLowerCase();
                if (cardLower.startsWith(prefixToMatch)) {
                  const suffixStr = cardLower.substring(prefixToMatch.length);
                  const suffixNum = parseInt(suffixStr, 10);
                  if (!isNaN(suffixNum) && suffixNum > maxSuffix) {
                    maxSuffix = suffixNum;
                  }
                }
              });

              countsPerEmp.set(relCountKey, maxSuffix);
            }

            const currentRelCount = countsPerEmp.get(relCountKey)! + 1;
            countsPerEmp.set(relCountKey, currentRelCount);
            
            finalCardNumber = matchedBaseCard + relCode + currentRelCount;
          }
        }
      }

      const rowKey = `${finalCardNumber}`;

      if (status !== "ERROR") {
        // 1. التحقق من التكرار داخل الملف
        if (seenInBatch.has(rowKey)) {
          status = "DUPLICATE";
          errorMsg = "[FILE] مكرر في نفس الملف" + (hasOldCard ? " - يحمل بطاقة قديمة" : "");
          report.duplicate++;
        }
        // 2. التحقق من التكرار بالمنظومة
        else {
          const existingInSystem = existingSystemBens.find(b => 
            b.card_number.toLowerCase() === finalCardNumber.toLowerCase() ||
            (b.card_number.toLowerCase().replace(/[wsdmfh]\d*$/i, "").endsWith(empNum.toLowerCase()) && stripSpaces(b.name) === stripSpaces(name))
          );

          if (existingInSystem) {
            // تحقق ما إذا كانت البطاقة الموجودة في المنظومة هي بطاقة قديمة (موسومة أو بدون أصفار)
            const isLegacySystemCard = existingInSystem.is_legacy_card || 
              !existingInSystem.card_number.toLowerCase().replace(/[wsdmfh]\d*$/i, "").match(new RegExp(`^${prefix.toLowerCase()}0+`));

            if (isLegacySystemCard) {
              status = "READY";
              errorMsg = "جاهز للتحديث برقم جديد (يحمل بطاقة قديمة بدون أصفار أو صيغة قديمة)";
              report.ready++;
            } else {
              status = "DUPLICATE";
              errorMsg = "[SYSTEM] موجود مسبقاً في المنظومة الرئيسية بنفس الترقيم الحديث";
              report.duplicate++;
            }
          }
          // 3. التحقق من التكرار في الأرشيف
          else {
            const existingInArchive = existingArchiveItems.find(a => 
              a.card_number.toLowerCase() === finalCardNumber.toLowerCase() ||
              (a.employee_number.toLowerCase() === empNum.toLowerCase() && stripSpaces(a.name) === stripSpaces(name))
            );

            if (existingInArchive) {
              const isMigrated = existingInArchive.status === "MIGRATED";
              if (isMigrated) {
                status = "DUPLICATE";
                errorMsg = "[ARCHIVE] هذا المستفيد تم ترحيله مسبقاً" + (hasOldCard ? " - يحمل بطاقة قديمة" : "");
                report.duplicate++;
              } else {
                status = "READY";
                report.ready++;
              }
            } else {
              report.ready++;
            }
          }
        }
      }

      seenInBatch.add(rowKey);

      let bDate = null;
      if (item.birth_date) {
        const d = new Date(item.birth_date);
        if (!isNaN(d.getTime())) {
          bDate = d;
        }
      }

      const { percentage: matchPercentage, mismatches } = calculateMatchPercentage(
        item.original_date,
        item.birth_date
      );

      let autoCity = item.city;
      let autoBatch = item.batch_number;

      const registryEntry = await prisma.cardIssuanceRegistry.findUnique({
        where: { card_number_upper: baseCard }
      });

      if (registryEntry) {
        autoCity = registryEntry.city;
        autoBatch = registryEntry.batch_number || autoBatch;
      }

      await prisma.cardNumberingArchive.upsert({
        where: { card_number: finalCardNumber },
        update: {
          name,
          employee_number: empNum,
          relationship: rel || null,
          birth_date: item.birth_date ? new Date(item.birth_date) : null,
          original_date: item.original_date || null,
          original_city: item.city || null,
          city: manualCity || autoCity || null,
          batch_number: (manualBatch && manualBatch.trim() !== "") ? manualBatch : (autoBatch || null),
          status,
          error_message: errorMsg,
          source_file: sourceFile,
          match_percentage: matchPercentage,
          mismatch_reasons: mismatches.length > 0 ? JSON.stringify(mismatches) : null,
          deleted_at: null
        },
        create: {
          card_number: finalCardNumber,
          name,
          employee_number: empNum,
          relationship: rel || null,
          birth_date: item.birth_date ? new Date(item.birth_date) : null,
          original_date: item.original_date || null,
          original_city: item.city || null,
          city: manualCity || autoCity || null,
          batch_number: (manualBatch && manualBatch.trim() !== "") ? manualBatch : (autoBatch || null),
          status,
          error_message: errorMsg,
          source_file: sourceFile,
          match_percentage: matchPercentage,
          mismatch_reasons: mismatches.length > 0 ? JSON.stringify(mismatches) : null,
          deleted_at: null,
          created_at: new Date(baseTime - loopIndex)
        },
      });
    }

    revalidatePath("/admin/card-numbering");
    return { success: true, report };
  } catch (error) {
    console.error("Import error:", error);
    return { error: "تعذر معالجة ملف الاستيراد" };
  }
}

export async function migrateCardNumberingAction(ids: string[]) {
  const session = await getSession();
  if (!session || !hasPermission(session, "migrate_card_numbering")) return { error: "غير مصرح" };

  const report = {
    total: ids.length,
    added: 0,
    updated: 0,
    failed: 0,
    details: [] as Array<{ name: string; card_number: string; status: string; reason: string }>
  };

  const migrationId = `MIG-${Date.now()}`;
  const changes = []; // لتخزين التغييرات لأغراض التراجع

  try {
    const companies = await prisma.insuranceCompany.findMany({
      where: { deleted_at: null }
    });
    const sortedCompanies = [...companies].sort((a, b) => b.code.length - a.code.length);

    const items = await prisma.cardNumberingArchive.findMany({
      where: {
        id: { in: ids },
        status: "READY"
      },
    });

    for (const item of items) {
      try {
        // تحديد الشركة المستهدفة بناء على البادئة لرقم البطاقة المُراد ترحيله
        let companyId = null;
        for (const cmp of sortedCompanies) {
          if (item.card_number.toLowerCase().startsWith(cmp.code.toLowerCase())) {
            companyId = cmp.id;
            break;
          }
        }

        // 1. البحث عن أي مستفيد موجود بنفس رقم البطاقة (حتى لو كان محذوفاً ناعماً)
        const existingByCard = await prisma.beneficiary.findFirst({
          where: {
            card_number: { equals: item.card_number.trim(), mode: "insensitive" }
          },
        });

        if (existingByCard) {
          // تحديث البيانات المستفيد الموجود بدلاً من الفشل
          const oldData = { ...existingByCard };
          await prisma.beneficiary.update({
            where: { id: existingByCard.id },
            data: {
              name: item.name,
              city: item.city || existingByCard.city,           // ترحيل المدينة
              batch_number: item.batch_number || existingByCard.batch_number, // ترحيل رقم الدفعة
              company_id: companyId || existingByCard.company_id, // ربط الشركة
              deleted_at: null, // استعادة السجل إذا كان في سلة المحذوفات
              status: "ACTIVE"
            }
          });
          report.updated++;
          report.details.push({ name: item.name, card_number: item.card_number, status: "UPDATED", reason: existingByCard.deleted_at ? "استعادة وتحديث من المحذوفات" : "تحديث بيانات موجودة" });
          changes.push({
            type: "UPDATE",
            beneficiaryId: existingByCard.id,
            name: item.name,
            oldCard: oldData.card_number,
            newCard: item.card_number
          });

          await prisma.cardNumberingArchive.update({
            where: { id: item.id },
            data: { status: "MIGRATED", migrated_at: new Date() },
          });
          continue;
        }

        // 2. البحث بالرقم الوظيفي كخيار ثانٍ (إذا كان رقم البطاقة مختلفاً ولكن الشخص هو نفسه)
        const existingByEmp = await prisma.beneficiary.findFirst({
          where: {
            card_number: { startsWith: item.employee_number },
            name: { equals: item.name, mode: "insensitive" },
            deleted_at: null
          },
        });

        if (existingByEmp) {
          // تحديث رقم البطاقة لشخص موجود
          const oldData = { ...existingByEmp };
          await prisma.beneficiary.update({
            where: { id: existingByEmp.id },
            data: {
              card_number: item.card_number,
              city: item.city || existingByEmp.city,           // ترحيل المدينة
              batch_number: item.batch_number || existingByEmp.batch_number, // ترحيل رقم الدفعة
              company_id: companyId || existingByEmp.company_id, // ربط الشركة
            }
          });
          report.updated++;
          report.details.push({ name: item.name, card_number: item.card_number, status: "UPDATED", reason: "تحديث رقم البطاقة لمستفيد موجود" });
          changes.push({
            type: "UPDATE",
            beneficiaryId: existingByEmp.id,
            name: item.name,
            oldCard: oldData.card_number,
            newCard: item.card_number
          });
        } else {
          // 3. إضافة جديد كلياً
          const newBen = await prisma.beneficiary.create({
            data: {
              name: item.name,
              card_number: item.card_number,
              city: item.city,           // ترحيل المدينة للجديد
              batch_number: item.batch_number, // ترحيل رقم الدفعة للجديد
              company_id: companyId,     // ربط المستفيد الجديد بالشركة المكتشفة تلقائياً
              status: "ACTIVE",
              total_balance: 600,
              remaining_balance: 600,
            },
          });
          report.added++;
          report.details.push({ name: item.name, card_number: item.card_number, status: "ADDED", reason: "مستفيد جديد" });
          changes.push({
            type: "CREATE",
            beneficiaryId: newBen.id,
            name: item.name,
            card_number: item.card_number
          });
        }

        await prisma.cardNumberingArchive.update({
          where: { id: item.id },
          data: { status: "MIGRATED", migrated_at: new Date() },
        });

        // تسجيل عملية الترحيل في سجل حركات المستفيد
        await prisma.transaction.create({
          data: {
            beneficiary_id: changes[changes.length - 1].beneficiaryId,
            facility_id: session.id,
            company_id: companyId, // ربط الحركة بالشركة
            amount: 0,
            type: "SETTLEMENT",
            idempotency_key: `MIG-REC-${item.id}`
          }
        });

      } catch (err) {
        report.failed++;
        report.details.push({ name: item.name, card_number: item.card_number, status: "FAIL", reason: "خطأ تقني أثناء الترحيل" });
      }
    }

    // سجل المراقبة
    await prisma.auditLog.create({
      data: {
        user: session.id,
        action: "CARD_NUMBERING_MIGRATION",
        metadata: {
          migrationId,
          report: { total: report.total, added: report.added, updated: report.updated, failed: report.failed },
          changes
        },
        facility_id: null
      }
    });

    revalidatePath("/admin/card-numbering");
    return { success: true, report };
  } catch (error) {
    return { error: "فشل عام في عملية الترحيل" };
  }
}

export async function rollbackMigrationAction(logId: string) {
  const session = await getSession();
  if (!session || !hasPermission(session, "migrate_card_numbering")) return { error: "غير مصرح" };

  try {
    const log = await prisma.auditLog.findUnique({ where: { id: logId } });
    if (!log || log.action !== "CARD_NUMBERING_MIGRATION") return { error: "سجل غير صالح" };

    const { changes } = log.metadata as { changes: Array<{ type: string; beneficiaryId: string; name: string; card_number?: string; oldCard?: string; newCard?: string }> };

    for (const change of changes) {
      if (change.type === "CREATE") {
        await prisma.beneficiary.delete({ where: { id: change.beneficiaryId } });
      } else if (change.type === "UPDATE") {
        await prisma.beneficiary.update({
          where: { id: change.beneficiaryId },
          data: { card_number: change.oldCard }
        });
      }
    }

    await prisma.auditLog.create({
      data: {
        user: session.id,
        action: "ROLLBACK_MIGRATION",
        metadata: { originalLogId: logId },
        facility_id: null
      }
    });

    return { success: true };
  } catch (error) {
    return { error: "فشل التراجع عن الترحيل" };
  }
}

export async function getMigrationLogs(search?: string) {
  const session = await getSession();
  if (!session || !hasPermission(session, "manage_card_numbering")) return { error: "غير مصرح" };

  const logs = await prisma.auditLog.findMany({
    where: {
      action: "CARD_NUMBERING_MIGRATION",
      OR: search ? [
        { user: { contains: search, mode: "insensitive" } },
        { metadata: { path: ["migrationId"], string_contains: search } }
      ] : undefined
    },
    orderBy: { created_at: "desc" },
    take: 50
  });

  return { logs };
}

export async function deleteCardNumberingArchiveItemsAction(ids: string[]) {
  const session = await getSession();
  if (!session || !hasPermission(session, "manage_card_numbering")) return { error: "غير مصرح" };

  try {
    await prisma.cardNumberingArchive.updateMany({
      where: { id: { in: ids } },
      data: { deleted_at: new Date() }
    });
    revalidatePath("/admin/card-numbering");
    return { success: true };
  } catch (error) {
    return { error: "تعذر نقل السجلات للسلة" };
  }
}

export async function restoreCardNumberingArchiveItemsAction(ids: string[]) {
  const session = await getSession();
  if (!session || !hasPermission(session, "manage_card_numbering")) return { error: "غير مصرح" };

  try {
    await prisma.cardNumberingArchive.updateMany({
      where: { id: { in: ids } },
      data: { deleted_at: null }
    });
    revalidatePath("/admin/card-numbering");
    return { success: true };
  } catch (error) {
    return { error: "تعذر استعادة السجلات" };
  }
}

export async function permanentlyDeleteCardNumberingArchiveItemsAction(ids: string[]) {
  const session = await getSession();
  if (!session || !hasPermission(session, "manage_card_numbering")) return { error: "غير مصرح" };

  try {
    await prisma.cardNumberingArchive.deleteMany({
      where: { id: { in: ids }, deleted_at: { not: null } } // أمان إضافي: الحذف النهائي فقط للمحذوف ناعما
    });
    revalidatePath("/admin/card-numbering");
    return { success: true };
  } catch (error) {
    return { error: "تعذر الحذف النهائي" };
  }
}

export async function clearCardNumberingArchiveAction() {
  const session = await getSession();
  if (!session || !hasPermission(session, "manage_card_numbering")) return { error: "غير مصرح" };

  try {
    await prisma.cardNumberingArchive.deleteMany({});
    revalidatePath("/admin/card-numbering");
    return { success: true };
  } catch (error) {
    return { error: "تعذر مسح الأرشيف" };
  }
}
