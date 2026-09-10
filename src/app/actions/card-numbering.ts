"use server";

import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import type { CardNumberingStatus } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { hasPermission } from "@/lib/session-guard";
import { cleanImportText, parseDateParts, escapeRegex } from "@/lib/card-import-utils";

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
  beneficiary_status?: string;
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
  "رب الأسرة", "رب العائلة", "رب أسرة", "رب عائلة", "رب الاسرة", "رب الاسره", "رب العائله",
  "صاحب البطاقة", "رئيسي", "الرئيسي", "الرئيسية", "الرئيسيه",
  "عضو جمارك", "عضو الجمارك", "(عضو جمارك)", "(عضو الجمارك)", "عضو",
  "MAIN", "EMPLOYEE",
  "متوفي", "متوفى", "وفاة", "حالة وفاة",
  "ملحق", "ملحقة", "ملحقه", "الملحق", "الملحقة"
];

/* getRelRank unused
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
*/

// parseDateParts مستوردة من src/lib/card-import-utils.ts (مشتركة مع العميل)

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

  // تحليل التاريخين إلى أجزاء قبل المقارنة: الملف يكتب التاريخ غالباً "يوم-شهر-سنة"
  // بينما التاريخ المحسوب "سنة-شهر-يوم"، فالمقارنة النصية الموضعية كانت تعتبرهما مختلفين دائماً.
  const origParsed = parseDateParts(original);
  const calcParsed = parseDateParts(calculated);

  if (origParsed && calcParsed) {
    if (origParsed.y !== calcParsed.y) {
      mismatches.push("السنة مختلفة");
      matchScore -= 40;
    }
    if (origParsed.m !== calcParsed.m) {
      mismatches.push("الشهر مختلف");
      matchScore -= 30;
    }
    if (origParsed.d !== calcParsed.d) {
      mismatches.push("اليوم مختلف");
      matchScore -= 30;
    }
    return { percentage: Math.max(0, matchScore), mismatches };
  }

  // تعذّر تحليل أحد التاريخين: نعود للمقارنة النصية الموضعية القديمة
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
  } catch (_error) {
    return { error: "تعذر جلب الأرشيف" };
  }
}

// تُنظّف أيضاً المحارف الاتجاهية غير المرئية والتطويل والأرقام العربية-الهندية
// (رأينا 49 سجلاً من ملف "جليانة دفعة سابعة" تحمل أسماء ملوّثة بهذه المحارف
// كانت تفشل كل مطابقة اسم مع المنظومة الرئيسية).
const normalizeArabicText = (text: string): string => {
  return cleanImportText(text)
    .toLowerCase()
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/\s+/g, " ");
};

const smartParseDate = (dateStr: string | undefined | null): Date | null => {
  if (!dateStr) return null;
  const str = String(dateStr).trim();
  
  // Try standard JS parse first
  const standardDate = new Date(str);
  if (!isNaN(standardDate.getTime())) {
    // Basic sanity check: ensure year is 4 digits (to avoid 1961/21/10 parsing as strange valid date in some engines)
    if (standardDate.getFullYear() > 1900 && standardDate.getFullYear() <= new Date().getFullYear()) {
       // Wait, some engines parse YYYY/DD/MM incorrectly and return a valid date but wrong month/day. 
       // We'll trust standard parsing UNLESS the string clearly has a year but fails.
    }
  }

  // Let's do a robust custom parse by parts
  const parts = str.split(/[-\/.]/).map(p => parseInt(p, 10)).filter(p => !isNaN(p));
  
  if (parts.length === 3) {
    let year = 0, month = 0, day = 0;

    // Format: YYYY / ? / ?
    if (parts[0] > 1000) {
      year = parts[0];
      if (parts[1] > 12 && parts[2] <= 12) {
        // YYYY / DD / MM
        day = parts[1];
        month = parts[2];
      } else if (parts[2] > 12 && parts[1] <= 12) {
        // YYYY / MM / DD
        month = parts[1];
        day = parts[2];
      } else {
        // Ambiguous or standard YYYY/MM/DD
        month = parts[1];
        day = parts[2];
      }
    } 
    // Format: ? / ? / YYYY
    else if (parts[2] > 1000) {
      year = parts[2];
      if (parts[0] > 12 && parts[1] <= 12) {
        // DD / MM / YYYY
        day = parts[0];
        month = parts[1];
      } else if (parts[1] > 12 && parts[0] <= 12) {
        // MM / DD / YYYY
        month = parts[0];
        day = parts[1];
      } else {
        // Default to European/Arabic DD/MM/YYYY
        day = parts[0];
        month = parts[1];
      }
    }

    if (year >= 1900 && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      // Valid parsed date!
      // Use UTC to prevent timezone shifts
      const d = new Date(Date.UTC(year, month - 1, day));
      if (!isNaN(d.getTime())) return d;
    }
  }

  // Fallback to standard JS parse
  const fallback = new Date(str);
  return isNaN(fallback.getTime()) ? null : fallback;
};


export async function importCardNumberingAction(data: CardNumberingItem[], options: { prefix: string, padding: number, sourceFile?: string, city?: string, batchNumber?: string }) {
  const session = await getSession();
  if (!session || !hasPermission(session, "manage_card_numbering")) return { error: "غير مصرح" };

  // يُستخدم في رسالة الخطأ عند فشل الاستيراد بالكامل، لتحديد الصفّ المتسبب بدل رسالة عمياء.
  // يجب أن يكون خارج try{} ليبقى مرئياً داخل catch{} (لهما نطاقا كتلة منفصلان في JS).
  let lastProcessedItem: { row: number; name?: string; employee_number?: string } = { row: 0 };

  try {
    const { prefix = "WAB2025", padding = 0, sourceFile = "يدوي", city: manualCity, batchNumber: manualBatch } = options;

    // تم إزالة فرز البيانات للحفاظ على ترتيب العائلات والأفراد بنفس ترتيب المصدر (ملف الإكسل) كما طلب المستخدم.
    const report = { total: data.length, ready: 0, duplicate: 0, error: 0, excluded: 0, excludedItems: [] as CardNumberingItem[] };
    const countsPerEmp = new Map<string, number>();
    const seenInBatch = new Set<string>();
    const seenFingerprints = new Set<string>();
    // يتتبّع أي بصمة (شخص) كتبت فعلياً كل رقم بطاقة ضمن هذا الاستيراد،
    // لمنع upsert اللاحق من استبدال سجل شخص صحيح ببيانات شخص آخر تصادف معه في نفس رقم البطاقة.
    const cardWrittenBy = new Map<string, string>();

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
      // FIX: new Date(invalid).toISOString() ترمي RangeError، وكانت تُسقط الاستيراد بالكامل
      // بلا أي إشارة لأي صفّ تسبب بذلك. الآن نتحقق من صحة التاريخ قبل التحويل.
      const date1 = new Date(d1);
      const date2 = new Date(d2);
      if (isNaN(date1.getTime()) || isNaN(date2.getTime())) return false;
      return date1.toISOString().split('T')[0] === date2.toISOString().split('T')[0];
    };

    const extractEmployeeNumber = (cardNumber: string, currentPrefix: string, companyCode?: string): string => {
      let card = cardNumber.toUpperCase();
      const pref = currentPrefix.toUpperCase();
      const comp = companyCode?.toUpperCase();
      
      if (card.startsWith(pref)) {
        card = card.substring(pref.length);
      } else if (comp && card.startsWith(comp)) {
        card = card.substring(comp.length);
      }
      
      card = card.replace(/[WSDMFH]\d*$/i, "");
      
      const yearMatch = pref.match(/\d+/);
      if (yearMatch) {
        const year = yearMatch[0];
        if (card.startsWith(year)) {
          card = card.substring(year.length);
        }
      }
      
      return card.replace(/^\D+/, "").replace(/^0+/, "");
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
        ] : [
          { card_number: { startsWith: prefixFilter, mode: "insensitive" } }
        ],
        deleted_at: null
      },
      select: { card_number: true, name: true, is_legacy_card: true, birth_date: true, company_id: true }
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
      lastProcessedItem = { row: loopIndex, name: item.name, employee_number: item.employee_number };
      const empNumRaw = String(item.employee_number || "").trim();
      const empNum = empNumRaw.replace(/^0+/, "");
      const name = String(item.name || "").trim();
      // الرقم الوظيفي الصالح: يحتوي رقماً، بلا مسافات، وبطول معقول.
      // هذا يمنع تسرّب اسم المستفيد إلى رقم البطاقة عند التقاط عمود خاطئ من الإكسيل.
      const isValidEmpNum = /\d/.test(empNum) && !/\s/.test(empNum) && empNum.length <= 20;
      const statusVal = String(item.status || "").trim();
      const relVal = String(item.relationship || "").trim();
      const notesVal = String(item.field3 || "").trim();

      const fullTextSearch = `${statusVal} ${name} ${relVal} ${notesVal}`.toLowerCase();
      const isDeceased = fullTextSearch.includes("متوفي") || fullTextSearch.includes("متوفى") || fullTextSearch.includes("وفاة");
      const isAppendix = fullTextSearch.includes("ملحق");
      const existingInSystemFast = existingSystemBens.find(b => {
        const cardLower = b.card_number.toLowerCase();
        const prefixLower = prefixFilter.toLowerCase();
        const belongsToCompany = cardLower.startsWith(prefixLower) || (targetCompany && b.company_id === targetCompany.id);
        if (!belongsToCompany) return false;

        const dbEmpNum = extractEmployeeNumber(b.card_number, prefix, targetCompany?.code);
        return dbEmpNum === empNum && normalizeArabicText(b.name) === normalizeArabicText(name);
      });
      const hasOldCard = existingInSystemFast?.is_legacy_card || false;

      // const birthDateVal = String(item.birth_date || "").trim();
      // const isMissingBirthDate = !birthDateVal;

      let status: CardNumberingStatus = "READY";
      let errorMsg: string | null = null;

      if (hasOldCard) {
        errorMsg = "ملاحظة: يحمل بطاقة قديمة";
      }

      if (!empNum || !name) {
        status = "ERROR";
        errorMsg = "الاسم والرقم الوظيفي مطلوبان" + (hasOldCard ? " - يحمل بطاقة قديمة" : "");
        report.error++;
      } else if (!isValidEmpNum) {
        status = "ERROR";
        errorMsg = `الرقم الوظيفي غير صالح: "${empNumRaw}" — تحقق من عمود الرقم الوظيفي في الملف` + (hasOldCard ? " - يحمل بطاقة قديمة" : "");
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
      const rel = String(item.relationship || "").trim();
      const isMain = !rel || MAIN_ACCOUNT_TERMS.includes(rel) || rel.toLowerCase() === "employee";

      let finalCardNumber = baseCard;

      if (empNum && name && isValidEmpNum) {
        // العثور على البادئة (رقم بطاقة الموظف الرئيسي) الموجودة بالفعل في المنظومة أو الأرشيف
        let matchedBaseCard = baseCard;
        // Use regex to allow any number of zeros for padding
        // (البادئة/الرقم الوظيفي يهرَّبان قبل الدخول في النمط لمنع كسر التعبير أو حقن نمط غير مقصود)
        const expectedPattern = new RegExp(`^${escapeRegex(prefix)}0*${escapeRegex(empNum)}$`, "i");
        
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
          !existingMainSystem.card_number.toLowerCase().replace(/[wsdmfh]\d*$/i, "").match(new RegExp(`^${escapeRegex(prefix.toLowerCase())}0+`))
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

          const checkMatch = (dbName: string, dbDate: unknown, dbCard: string) => {
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

          const systemMatch = existingSystemBens.find(b => {
            const cardLower = b.card_number.toLowerCase();
            const prefixLower = prefixFilter.toLowerCase();
            const belongsToCompany = cardLower.startsWith(prefixLower) || (targetCompany && b.company_id === targetCompany.id);
            if (!belongsToCompany) return false;

            const dbEmpNum = extractEmployeeNumber(b.card_number, prefix, targetCompany?.code);
            return dbEmpNum === empNum && checkMatch(b.name, b.birth_date, b.card_number);
          });

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
      const fingerprint = `${empNum}_${stripSpaces(name)}_${item.birth_date || ""}`;

      if (status !== "ERROR") {
        // 1. التحقق من التكرار داخل الملف
        if (seenInBatch.has(rowKey) || seenFingerprints.has(fingerprint)) {
          status = "DUPLICATE";
          // تمييز السبب الحقيقي: صف بلا صلة قرابة يُعتبر حساباً رئيسياً فيصطدم ببطاقة الموظف نفسه
          const isUnreadRelClash = !rel && seenInBatch.has(rowKey) && !seenFingerprints.has(fingerprint);
          errorMsg = (isUnreadRelClash
            ? "[FILE] تعذّرت قراءة صلة القرابة فاعتُبر حساباً رئيسياً واصطدم ببطاقة الموظف نفسه"
            : "[FILE] مكرر في نفس الملف") + (hasOldCard ? " - يحمل بطاقة قديمة" : "");
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
              !existingInSystem.card_number.toLowerCase().replace(/[wsdmfh]\d*$/i, "").match(new RegExp(`^${escapeRegex(prefix.toLowerCase())}0+`));

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
              // نفس رقم البطاقة لكن لشخص مختلف تماماً (رقم وظيفي واسم مختلفان):
              // upsert بمفتاح card_number كان سيحذف/يستبدل سجل الشخص الآخر صامتاً. نمنع ذلك.
              const sameCardDifferentPerson =
                existingInArchive.card_number.toLowerCase() === finalCardNumber.toLowerCase() &&
                existingInArchive.employee_number.toLowerCase() !== empNum.toLowerCase() &&
                stripSpaces(existingInArchive.name) !== stripSpaces(name);

              if (isMigrated) {
                status = "DUPLICATE";
                errorMsg = "[ARCHIVE] هذا المستفيد تم ترحيله مسبقاً" + (hasOldCard ? " - يحمل بطاقة قديمة" : "");
                report.duplicate++;
              } else if (sameCardDifferentPerson) {
                status = "ERROR";
                errorMsg = `تعارض: رقم البطاقة ${finalCardNumber} مستخدم بالفعل لشخص مختلف (${existingInArchive.name.trim()} - ${existingInArchive.employee_number})`;
                report.error++;
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
      seenFingerprints.add(fingerprint);

      const bDate = smartParseDate(item.birth_date);

      const { percentage: matchPercentage, mismatches } = calculateMatchPercentage(
        item.original_date,
        item.birth_date
      );

      const autoCity = item.city;
      const autoBatch = item.batch_number;

      let parsedBeneficiaryStatus: string | null = null;
      if (statusVal) {
        const normalized = statusVal.trim().toLowerCase();
        if (normalized.includes("موقوف") || normalized.includes("موقف") || normalized.includes("suspend") || normalized.includes("inactive")) {
          parsedBeneficiaryStatus = "SUSPENDED";
        } else if (normalized.includes("نشط") || normalized.includes("active")) {
          parsedBeneficiaryStatus = "ACTIVE";
        }
      }

      // منع الكتابة الصامتة: إن كتب صفّ سابق في نفس هذا الاستيراد رقم البطاقة هذا لشخص مختلف
      // (بصمة مختلفة)، فلا نستبدل بياناته الصحيحة ببيانات صفّ متعارض لاحق. الصف المتعارض
      // يبقى مُحتسباً في التقرير (DUPLICATE/ERROR) لكن دون أن يمسّ السجل الأول.
      const previousWriterFingerprint = cardWrittenBy.get(finalCardNumber);
      const isConflictingWithEarlierWrite = previousWriterFingerprint !== undefined && previousWriterFingerprint !== fingerprint;

      if (isConflictingWithEarlierWrite) {
        if (status === "READY") {
          report.ready--;
          report.duplicate++;
        }
        status = "DUPLICATE";
        errorMsg = `[FILE] تعارض على رقم البطاقة ${finalCardNumber} مع صفّ سابق في نفس الملف لشخص مختلف`;
      } else {
        cardWrittenBy.set(finalCardNumber, fingerprint);
      }

      if (!isConflictingWithEarlierWrite) await prisma.cardNumberingArchive.upsert({
        where: { card_number: finalCardNumber },
        update: {
          name,
          employee_number: empNum,
          relationship: rel || null,
          birth_date: bDate,
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
          beneficiary_status: parsedBeneficiaryStatus
        },
        create: {
          card_number: finalCardNumber,
          name,
          employee_number: empNum,
          relationship: rel || null,
          birth_date: bDate,
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
          created_at: new Date(baseTime - loopIndex),
          beneficiary_status: parsedBeneficiaryStatus
        },
      });
    }

    revalidatePath("/admin/card-numbering");
    return { success: true, report };
  } catch (_error) {
    // FIX: كانت الرسالة عامة دائماً، فلا يمكن معرفة أي صفّ تسبب في الفشل (مثال: تاريخ غير صالح
    // يُسقط isSameDate برمي RangeError). الآن نشير للصفّ الأخير الذي بدأت معالجته.
    console.error("Import error at row", lastProcessedItem.row, lastProcessedItem, ":", _error);
    const detail = lastProcessedItem.row > 0
      ? ` (توقف عند الصف ${lastProcessedItem.row}${lastProcessedItem.name ? `: "${lastProcessedItem.name}"` : ""})`
      : "";
    return { error: `تعذر معالجة ملف الاستيراد${detail}` };
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

        // FIX: كل كتابات هذا الصف (المستفيد + حالة الأرشيف + حركة السجل) تُنفَّذ الآن
        // داخل معاملة واحدة ذرّية. سابقاً كانت 3 كتابات منفصلة: أي فشل بعد الأولى كان
        // يترك مستفيداً تمّت كتابته فعلياً في المنظومة بينما تُحتسب العملية "فاشلة"،
        // وسجل الأرشيف يبقى READY فلا يُعاد ترحيله ولا يُعرف أنه كُتب فعلاً.
        const migratedChange = await prisma.$transaction(async (tx) => {
          // 1. البحث عن أي مستفيد موجود بنفس رقم البطاقة (حتى لو كان محذوفاً ناعماً)
          const existingByCard = await tx.beneficiary.findFirst({
            where: {
              card_number: { equals: item.card_number.trim(), mode: "insensitive" }
            },
          });

          let change: {
            type: "CREATE" | "UPDATE";
            beneficiaryId: string;
            name: string;
            archiveId: string;
            oldCard?: string;
            newCard?: string;
            before?: { name: string; city: string | null; batch_number: string | null; company_id: string | null; deleted_at: string | null; status: string; card_number: string };
          };
          let reportEntry: { name: string; card_number: string; status: string; reason: string };

          if (existingByCard) {
            // تحديث بيانات المستفيد الموجود بدلاً من الفشل
            const before = {
              name: existingByCard.name,
              city: existingByCard.city,
              batch_number: existingByCard.batch_number,
              company_id: existingByCard.company_id,
              deleted_at: existingByCard.deleted_at ? existingByCard.deleted_at.toISOString() : null,
              status: existingByCard.status,
              card_number: existingByCard.card_number,
            };
            const targetStatus = (item.beneficiary_status === "ACTIVE" || item.beneficiary_status === "SUSPENDED")
              ? item.beneficiary_status
              : (existingByCard.status || "ACTIVE");

            await tx.beneficiary.update({
              where: { id: existingByCard.id },
              data: {
                name: item.name,
                city: item.city || existingByCard.city,
                batch_number: item.batch_number || existingByCard.batch_number,
                company_id: companyId || existingByCard.company_id,
                deleted_at: null,
                status: targetStatus as "ACTIVE" | "SUSPENDED" | "FINISHED"
              }
            });

            change = { type: "UPDATE", beneficiaryId: existingByCard.id, name: item.name, archiveId: item.id, oldCard: before.card_number, newCard: item.card_number, before };
            reportEntry = { name: item.name, card_number: item.card_number, status: "UPDATED", reason: existingByCard.deleted_at ? "استعادة وتحديث من المحذوفات" : "تحديث بيانات موجودة" };
          } else {
            // 2. البحث عن نفس الشخص برقم بطاقة مختلف (مثلاً بطاقة قديمة) ضمن نفس الشركة
            const existingByEmp = await tx.beneficiary.findFirst({
              where: {
                name: { equals: item.name, mode: "insensitive" },
                NOT: { card_number: { equals: item.card_number, mode: "insensitive" } },
                deleted_at: null,
                is_legacy_card: true,
                ...(companyId ? { company_id: companyId } : {}),
              },
            });

            if (existingByEmp) {
              const before = {
                name: existingByEmp.name,
                city: existingByEmp.city,
                batch_number: existingByEmp.batch_number,
                company_id: existingByEmp.company_id,
                deleted_at: existingByEmp.deleted_at ? existingByEmp.deleted_at.toISOString() : null,
                status: existingByEmp.status,
                card_number: existingByEmp.card_number,
              };
              const targetStatus = (item.beneficiary_status === "ACTIVE" || item.beneficiary_status === "SUSPENDED")
                ? item.beneficiary_status
                : (existingByEmp.status || "ACTIVE");

              await tx.beneficiary.update({
                where: { id: existingByEmp.id },
                data: {
                  card_number: item.card_number,
                  city: item.city || existingByEmp.city,
                  batch_number: item.batch_number || existingByEmp.batch_number,
                  company_id: companyId || existingByEmp.company_id,
                  status: targetStatus as "ACTIVE" | "SUSPENDED" | "FINISHED"
                }
              });

              change = { type: "UPDATE", beneficiaryId: existingByEmp.id, name: item.name, archiveId: item.id, oldCard: before.card_number, newCard: item.card_number, before };
              reportEntry = { name: item.name, card_number: item.card_number, status: "UPDATED", reason: "تحديث رقم البطاقة لمستفيد موجود" };
            } else {
              // 3. إضافة جديد كلياً
              const targetStatus = (item.beneficiary_status === "ACTIVE" || item.beneficiary_status === "SUSPENDED")
                ? item.beneficiary_status
                : "ACTIVE";

              const newBen = await tx.beneficiary.create({
                data: {
                  name: item.name,
                  card_number: item.card_number,
                  city: item.city,
                  batch_number: item.batch_number,
                  company_id: companyId,
                  status: targetStatus as "ACTIVE" | "SUSPENDED" | "FINISHED",
                  total_balance: 600,
                  remaining_balance: 600,
                },
              });

              change = { type: "CREATE", beneficiaryId: newBen.id, name: item.name, archiveId: item.id, card_number: item.card_number } as typeof change;
              reportEntry = { name: item.name, card_number: item.card_number, status: "ADDED", reason: "مستفيد جديد" };
            }
          }

          await tx.cardNumberingArchive.update({
            where: { id: item.id },
            data: { status: "MIGRATED", migrated_at: new Date() },
          });

          // تسجيل عملية الترحيل في سجل حركات المستفيد
          await tx.transaction.create({
            data: {
              beneficiary_id: change.beneficiaryId,
              facility_id: session.id,
              company_id: companyId,
              amount: 0,
              type: "SETTLEMENT",
              idempotency_key: `MIG-REC-${item.id}`
            }
          });

          return { change, reportEntry };
        });

        if (migratedChange.reportEntry.status === "ADDED") report.added++; else report.updated++;
        report.details.push(migratedChange.reportEntry);
        changes.push(migratedChange.change);

      } catch (_err) {
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
  } catch (_error) {
    return { error: "فشل عام في عملية الترحيل" };
  }
}

export async function rollbackMigrationAction(logId: string) {
  const session = await getSession();
  if (!session || !hasPermission(session, "migrate_card_numbering")) return { error: "غير مصرح" };

  type MigrationChange = {
    type: "CREATE" | "UPDATE";
    beneficiaryId: string;
    name: string;
    archiveId?: string;
    card_number?: string;
    oldCard?: string;
    newCard?: string;
    before?: { name: string; city: string | null; batch_number: string | null; company_id: string | null; deleted_at: string | null; status: string; card_number: string };
  };

  try {
    const log = await prisma.auditLog.findUnique({ where: { id: logId } });
    if (!log || log.action !== "CARD_NUMBERING_MIGRATION") return { error: "سجل غير صالح" };

    // FIX: منع التراجع المزدوج عن نفس عملية الترحيل (كان بالإمكان استدعاؤها مرات
    // متعددة، فتحاول حذف مستفيدين محذوفين بالفعل أو استعادة بيانات قديمة فوق بيانات
    // تراجعت عنها من قبل).
    const alreadyRolledBack = await prisma.auditLog.findFirst({
      where: { action: "ROLLBACK_MIGRATION", metadata: { path: ["originalLogId"], equals: logId } }
    });
    if (alreadyRolledBack) return { error: "تم التراجع عن هذا الترحيل مسبقاً" };

    const { changes } = log.metadata as { migrationId?: string; changes: MigrationChange[] };
    const report = { total: changes.length, reverted: 0, failed: 0, details: [] as Array<{ name: string; status: string; reason: string }> };

    for (const change of changes) {
      try {
        // FIX: كل استرجاع لصفّ واحد يُنفَّذ الآن ذرّياً (المستفيد + حركة الترحيل + حالة الأرشيف معاً)
        await prisma.$transaction(async (tx) => {
          if (change.type === "CREATE") {
            // FIX: كانت beneficiary.delete تفشل حتماً لأن الترحيل أنشأ Transaction تشير
            // إلى هذا المستفيد بعلاقة مطلوبة — يجب حذف حركة الترحيل أولاً.
            // تنبيه أمان بيانات: الحذف يستهدف idempotency_key المحدد فقط (وليس كل حركات
            // المستفيد) — لا نحذف شيئاً إن غاب archiveId حتى لا نمحو حركات مالية حقيقية للمستفيد.
            if (change.archiveId) {
              await tx.transaction.deleteMany({
                where: { idempotency_key: `MIG-REC-${change.archiveId}`, beneficiary_id: change.beneficiaryId }
              });
            }
            await tx.beneficiary.delete({ where: { id: change.beneficiaryId } });
          } else if (change.type === "UPDATE") {
            if (change.before) {
              // FIX: كان يُستعاد رقم البطاقة فقط، بينما الترحيل يدوس أيضاً الاسم والمدينة
              // والدفعة والشركة والحالة — فتُفقد هذه القيم القديمة نهائياً عند التراجع.
              await tx.beneficiary.update({
                where: { id: change.beneficiaryId },
                data: {
                  name: change.before.name,
                  city: change.before.city,
                  batch_number: change.before.batch_number,
                  company_id: change.before.company_id,
                  deleted_at: change.before.deleted_at ? new Date(change.before.deleted_at) : null,
                  status: change.before.status as "ACTIVE" | "SUSPENDED" | "FINISHED",
                  card_number: change.before.card_number,
                }
              });
            } else {
              // سجلات ترحيل قديمة سابقة لهذا الإصلاح لا تحمل لقطة "before" كاملة
              await tx.beneficiary.update({
                where: { id: change.beneficiaryId },
                data: { card_number: change.oldCard }
              });
            }
            // نفس التنبيه: لا نحذف أي حركة إن غاب archiveId، منعاً لحذف حركات المستفيد الحقيقية.
            if (change.archiveId) {
              await tx.transaction.deleteMany({
                where: { idempotency_key: `MIG-REC-${change.archiveId}`, beneficiary_id: change.beneficiaryId }
              });
            }
          }

          // FIX: إعادة سجل الأرشيف إلى READY حتى يمكن ترحيله من جديد بعد التراجع
          if (change.archiveId) {
            await tx.cardNumberingArchive.update({
              where: { id: change.archiveId },
              data: { status: "READY", migrated_at: null }
            });
          }
        });
        report.reverted++;
        report.details.push({ name: change.name, status: "REVERTED", reason: change.type === "CREATE" ? "حُذف المستفيد المُضاف" : "أُعيدت بيانات المستفيد" });
      } catch (_err) {
        report.failed++;
        report.details.push({ name: change.name, status: "FAIL", reason: "تعذّر التراجع عن هذا السجل" });
      }
    }

    await prisma.auditLog.create({
      data: {
        user: session.id,
        action: "ROLLBACK_MIGRATION",
        metadata: { originalLogId: logId, report },
        facility_id: null
      }
    });

    revalidatePath("/admin/card-numbering");
    return { success: true, report };
  } catch (_error) {
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
  } catch (_error) {
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
  } catch (_error) {
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
  } catch (_error) {
    return { error: "تعذر الحذف النهائي" };
  }
}

export async function clearCardNumberingArchiveAction() {
  const session = await getSession();
  if (!session || !hasPermission(session, "manage_card_numbering")) return { error: "غير مصرح" };

  try {
    // FIX: كانت deleteMany({}) تمسح الأرشيف بأكمله بلا شرط — كل الشركات وكل الدفعات
    // وسجلات MIGRATED التاريخية، بلا سلة محذوفات وبلا سجل مراقبة. الآن مقصورة على
    // السجلات الموجودة أصلاً في سلة المحذوفات (نفس نطاق الحذف النهائي الفردي)،
    // ومسجّلة في سجل المراقبة لإمكانية التتبع.
    const result = await prisma.cardNumberingArchive.deleteMany({
      where: { deleted_at: { not: null } }
    });

    await prisma.auditLog.create({
      data: {
        user: session.id,
        action: "CARD_NUMBERING_ARCHIVE_CLEAR",
        metadata: { deletedCount: result.count },
        facility_id: null
      }
    });

    revalidatePath("/admin/card-numbering");
    return { success: true, deletedCount: result.count };
  } catch (_error) {
    return { error: "تعذر مسح الأرشيف" };
  }
}
