/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs");
const path = require("node:path");
const ExcelJS = require("exceljs");
const { PrismaClient } = require("@prisma/client");

const SOURCE_DIR = path.resolve(__dirname, "المخصص كاش كليم طرابلس");
const REGISTRY_FILE = "C:/Users/Omar/Downloads/beneficiaries-active (2).xlsx";
const OUTPUT_DIR = path.join(SOURCE_DIR, "نتائج معالجة الحسميات");
const BATCHES = [100, 101, 102, 104, 106, 107, 109];

// اعتمد المستخدم هذه الصفوف على مستوى العائلة من المراجعة اليدوية المصورة.
// لا يعني ذلك تأكيد هوية المريض نفسه؛ المطلوب في Cash Claim هو توزيع الفاتورة
// على العائلة الصحيحة، ولذلك نستخدم ممثل العائلة في التقرير فقط.
const MANUALLY_CONFIRMED_FAMILY_ROWS = new Set([
  "100:10", // 104329
  "100:22", // 11677
  "102:25", // 3112
  "102:35", // 105445
  "106:7",  // 11438
  "106:9",  // 11605
  "106:12", // 11342
  "107:10", // 105185
  "107:19", // 105471
]);

const UNVERIFIED_ROW_REASONS = new Map([
  ["101:28", "معلّم بالأصفر: لم يتم التحقق من العائلة للرقم الوظيفي 260"],
  ["101:30", "معلّم بالأصفر: لم يتم التحقق من العائلة للرقم الوظيفي 2625"],
  ["106:22", "أُلغي الربط اليدوي الخاطئ ببطاقة WAB2025104509؛ لم يتم التحقق من عائلة الرقم 4509"],
  ["109:16", "معلّم بالأصفر: لم يتم التحقق من العائلة للرقم الوظيفي 11679"],
  ["109:18", "معلّم بالأصفر: لم يتم التحقق من العائلة للرقم الوظيفي 1193"],
]);

const MANUAL_FAMILY_KEY_OVERRIDES = new Map();

function parseArgs(argv) {
  const options = {
    registryFromDb: false,
    registryFile: REGISTRY_FILE,
    outputDir: OUTPUT_DIR,
  };
  let outputExplicit = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--registry-from-db") options.registryFromDb = true;
    else if (arg === "--registry-file") options.registryFile = path.resolve(argv[++index] || options.registryFile);
    else if (arg === "--output-dir") {
      options.outputDir = path.resolve(argv[++index] || options.outputDir);
      outputExplicit = true;
    } else {
      throw new Error(`وسيط غير معروف: ${arg}`);
    }
  }
  if (options.registryFromDb && !outputExplicit) {
    options.outputDir = path.join(SOURCE_DIR, "نتائج معالجة الحسميات - قاعدة البيانات الحالية");
  }
  return options;
}

function cellText(value) {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    if (value.result != null) return cellText(value.result);
    if (value.text != null) return String(value.text).trim();
    if (Array.isArray(value.richText)) return value.richText.map((part) => part.text || "").join("").trim();
  }
  return String(value).trim();
}

function numberValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const normalized = cellText(value).replace(/,/g, "").replace(/٫/g, ".").trim();
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeArabic(value) {
  return cellText(value)
    .toLowerCase()
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[ًٌٍَُِّْـ]/g, "")
    .replace(/[^؀-ۿ0-9a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactName(value) {
  return normalizeArabic(value).replace(/\s+/g, "");
}

function digits(value) {
  const result = cellText(value).replace(/[^0-9]/g, "").replace(/^0+/, "");
  return result || "";
}

function levenshtein(a, b) {
  if (!a) return b.length;
  if (!b) return a.length;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[b.length];
}

function nameScore(input, candidate) {
  const a = compactName(input);
  const b = compactName(candidate);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if ((a.length >= 3 && b.includes(a)) || (b.length >= 3 && a.includes(b))) return 0.94;

  const simplifyToken = (token) => (token.startsWith("ال") && token.length > 4 ? token.slice(2) : token);
  const aTokens = normalizeArabic(input).split(" ").filter(Boolean).map(simplifyToken);
  const bTokens = normalizeArabic(candidate).split(" ").filter(Boolean).map(simplifyToken);
  const matched = aTokens.filter((token) => bTokens.includes(token)).length;
  const tokenScore = matched / Math.max(1, aTokens.length);
  const fuzzyTokenScore = aTokens.reduce((sum, token) => {
    const bestToken = bTokens.reduce((best, other) => {
      const score = 1 - levenshtein(token, other) / Math.max(token.length, other.length);
      return Math.max(best, score);
    }, 0);
    return sum + bestToken;
  }, 0) / Math.max(1, aTokens.length);
  const editScore = 1 - levenshtein(a, b) / Math.max(a.length, b.length);
  return Math.max(tokenScore, fuzzyTokenScore, editScore);
}

function relationCode(value) {
  const raw = cellText(value)
    .toLowerCase()
    .replace(/[أإآٱ]/g, "ا")
    .replace(/[ًٌٍَُِّْـ]/g, "")
    .replace(/\s+/g, "");
  if (!raw) return "";
  if (raw.includes("نفس") || raw.includes("موظف")) return "MAIN";
  if (raw.includes("زوج")) return "W";
  if (raw.includes("والدت") || raw === "ام" || raw === "الام") return "M";
  if (raw.includes("والد") || raw === "اب" || raw === "الاب") return "F";
  if (raw.includes("ابنت") || raw.includes("ابنة") || raw.includes("بنت")) return "D";
  // "ابنه" is ambiguous in these source files: it is used both as a
  // possessive form for a son and as a misspelling of "ابنة". Let the name
  // select from the whole family instead of forcing the wrong card suffix.
  if (raw.includes("ابنه")) return "";
  if (raw.includes("ابن")) return "S";
  if (raw.includes("اخ")) return "B";
  return "";
}

function cardParts(card) {
  const normalized = cellText(card).toUpperCase().replace(/\s+/g, "");
  // Historic imports did not use one fixed zero-padding width. The employee
  // number is therefore the complete numeric part after WAB2025, with leading
  // zeroes removed, while the optional relationship suffix starts at a letter.
  const match = normalized.match(/^WAB2025(\d+)([A-Z](?:\d+)?)?$/);
  if (!match) return null;
  return {
    card: normalized,
    familyKey: String(Number(match[1])),
    suffix: match[2] || "",
    relation: match[2] ? match[2][0] : "MAIN",
  };
}

function findBestByName(name, candidates) {
  const scored = candidates
    .map((candidate) => ({ candidate, score: nameScore(name, candidate.name) }))
    .sort((a, b) => b.score - a.score);
  return {
    best: scored[0] || null,
    second: scored[1] || null,
  };
}

function buildRegistryFromMembers(members) {
  const families = new Map();
  for (const member of members) {
    if (!families.has(member.familyKey)) families.set(member.familyKey, []);
    families.get(member.familyKey).push(member);
  }
  const heads = members.filter((member) => member.relation === "MAIN");
  return { families, heads, members };
}

async function loadRegistryFromExcel(registryFile) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(registryFile);
  const sheet = workbook.getWorksheet("Beneficiaries") || workbook.worksheets[0];
  const members = [];

  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const parts = cardParts(row.getCell(3).value);
    if (!parts) continue;
    const member = {
      registryRow: rowNumber,
      name: cellText(row.getCell(2).value),
      card: parts.card,
      familyKey: parts.familyKey,
      relation: parts.relation,
      birthDate: cellText(row.getCell(4).value),
      totalBalance: numberValue(row.getCell(6).value),
      remainingBalance: numberValue(row.getCell(7).value),
    };
    members.push(member);
  }
  return buildRegistryFromMembers(members);
}

async function loadRegistryFromDatabase(prisma) {
  const rows = await prisma.beneficiary.findMany({
    where: { deleted_at: null },
    select: {
      id: true,
      name: true,
      card_number: true,
      birth_date: true,
      total_balance: true,
      remaining_balance: true,
    },
  });
  const members = [];
  for (const row of rows) {
    const parts = cardParts(row.card_number);
    if (!parts) continue;
    members.push({
      registryRow: 0,
      databaseId: row.id,
      name: row.name,
      card: parts.card,
      familyKey: parts.familyKey,
      relation: parts.relation,
      birthDate: row.birth_date ? row.birth_date.toISOString().slice(0, 10) : "",
      totalBalance: numberValue(row.total_balance),
      remainingBalance: numberValue(row.remaining_balance),
    });
  }
  return buildRegistryFromMembers(members);
}

function resolveFamily(employeeNumber, employeeName, registry) {
  const directKey = digits(employeeNumber);
  if (directKey && registry.families.has(directKey)) {
    return { familyKey: directKey, method: "الرقم الوظيفي", confidence: "عالية" };
  }

  const { best, second } = findBestByName(employeeName, registry.heads);
  if (best && best.score >= 0.82 && (!second || best.score - second.score >= 0.08)) {
    return {
      familyKey: best.candidate.familyKey,
      method: directKey ? "الاسم (الرقم غير موجود بالسجل)" : "اسم الموظف",
      confidence: best.score >= 0.94 ? "عالية" : "متوسطة",
    };
  }
  return { familyKey: "", method: "غير مطابق", confidence: "غير مطابق" };
}

function resolveBeneficiary(beneficiaryName, relation, employeeName, familyMembers) {
  if (!familyMembers?.length) return { member: null, method: "العائلة غير مطابقة", confidence: "غير مطابق" };

  const relationHint = relationCode(relation);
  const beneficiaryNormalized = compactName(beneficiaryName);
  const selfWords = new Set(["", "نفسه", "نفسها", "نفس", "هو", "هي"]);
  const explicitlySelf = Boolean(beneficiaryNormalized && selfWords.has(beneficiaryNormalized));
  if (relationHint === "MAIN" || explicitlySelf || (!relationHint && !beneficiaryNormalized)) {
    const head = familyMembers.find((member) => member.relation === "MAIN");
    return head
      ? { member: head, method: "صاحب البطاقة الرئيسي", confidence: "عالية" }
      : { member: null, method: "لا يوجد رئيسي", confidence: "غير مطابق" };
  }

  let candidates = familyMembers;
  if (relationHint) {
    const byRelation = familyMembers.filter((member) => member.relation === relationHint);
    if (byRelation.length) candidates = byRelation;
  }

  const lookupName = beneficiaryNormalized && !selfWords.has(beneficiaryNormalized) ? beneficiaryName : employeeName;
  const { best, second } = findBestByName(lookupName, candidates);
  if (!best) return { member: null, method: "لا يوجد مرشح", confidence: "غير مطابق" };

  const uniqueRelationCandidate = Boolean(relationHint && candidates.length === 1);
  if (!beneficiaryNormalized && uniqueRelationCandidate) {
    return {
      member: best.candidate,
      method: "صلة قرابة وحيدة داخل العائلة",
      confidence: "متوسطة",
    };
  }
  const clearName = best.score >= 0.72 && (!second || best.score - second.score >= 0.08);
  if (best.score >= 0.94 || clearName || (uniqueRelationCandidate && best.score >= 0.45)) {
    return {
      member: best.candidate,
      method: relationHint ? "الاسم وصلة القرابة" : "الاسم داخل العائلة",
      confidence: best.score >= 0.94 ? "عالية" : "متوسطة",
    };
  }

  return {
    member: null,
    method: `مطابقة ملتبسة (أفضل مرشح: ${best.candidate.name})`,
    confidence: "تحتاج مراجعة",
  };
}

async function readClaims(registry) {
  const claims = [];
  for (const batch of BATCHES) {
    const sourceFile = path.join(SOURCE_DIR, `خصم المخصص ${batch}.xlsx`);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(sourceFile);
    const sheet = workbook.worksheets[0];

    for (let rowNumber = 6; rowNumber <= sheet.rowCount; rowNumber += 1) {
      const row = sheet.getRow(rowNumber);
      const employeeName = cellText(row.getCell(2).value);
      const employeeNumber = cellText(row.getCell(3).value);
      const beneficiaryInput = cellText(row.getCell(4).value);
      const relation = cellText(row.getCell(5).value);
      const examination = numberValue(row.getCell(6).value);
      const examinationDate = cellText(row.getCell(7).value);
      const medicines = numberValue(row.getCell(8).value);
      const medicineDate = cellText(row.getCell(9).value);
      const medicineType = cellText(row.getCell(10).value);

      if (!employeeName && !employeeNumber && !beneficiaryInput) continue;
      if (!examination && !medicines) continue;

      const reviewKey = `${batch}:${rowNumber}`;
      let familyMatch = resolveFamily(employeeNumber, employeeName, registry);
      const manualFamilyKey = MANUAL_FAMILY_KEY_OVERRIDES.get(reviewKey);
      if (manualFamilyKey && registry.families.has(manualFamilyKey)) {
        familyMatch = {
          familyKey: manualFamilyKey,
          method: "ربط يدوي ببطاقة العائلة من مراجعة المستخدم",
          confidence: "اعتماد يدوي",
        };
      }
      const familyMembers = familyMatch.familyKey ? registry.families.get(familyMatch.familyKey) : null;
      let personMatch = resolveBeneficiary(beneficiaryInput, relation, employeeName, familyMembers);
      const manualFamilyConfirmed = MANUALLY_CONFIRMED_FAMILY_ROWS.has(reviewKey) && Boolean(familyMembers?.length);
      if (manualFamilyConfirmed) {
        const representative = familyMembers.find((member) => member.relation === "MAIN") || familyMembers[0];
        personMatch = {
          member: representative,
          method: "اعتماد يدوي للعائلة من مراجعة المستخدم",
          confidence: "اعتماد يدوي",
        };
      }
      const beneficiary = personMatch.member;
      claims.push({
        batch,
        sourceFile,
        sourceRow: rowNumber,
        employeeName,
        employeeNumber,
        beneficiaryInput,
        relation,
        examination,
        examinationDate,
        medicines,
        medicineDate,
        medicineType,
        invoiceTotal: examination + medicines,
        familyKey: familyMatch.familyKey,
        familyMatchMethod: familyMatch.method,
        familyConfidence: familyMatch.confidence,
        beneficiaryName: beneficiary?.name || "",
        card: beneficiary?.card || "",
        beneficiaryRemaining: beneficiary?.remainingBalance ?? null,
        personMatchMethod: personMatch.method,
        personConfidence: personMatch.confidence,
        manualFamilyConfirmed,
        unverifiedReason: UNVERIFIED_ROW_REASONS.get(reviewKey) || "",
      });
    }
  }
  return claims;
}

function calculateSummaries(claims, registry) {
  const familyClaims = new Map();
  const cardClaims = new Map();
  for (const claim of claims) {
    if (claim.familyKey) {
      if (!familyClaims.has(claim.familyKey)) familyClaims.set(claim.familyKey, []);
      familyClaims.get(claim.familyKey).push(claim);
    }
    if (claim.card) {
      if (!cardClaims.has(claim.card)) cardClaims.set(claim.card, []);
      cardClaims.get(claim.card).push(claim);
    }
  }

  const families = [];
  for (const [familyKey, groupedClaims] of familyClaims) {
    const members = registry.families.get(familyKey) || [];
    const head = members.find((member) => member.relation === "MAIN");
    const totalInvoice = groupedClaims.reduce((sum, claim) => sum + claim.invoiceTotal, 0);
    const familyRemaining = members.reduce((sum, member) => sum + member.remainingBalance, 0);
    families.push({
      familyKey,
      headName: head?.name || groupedClaims[0].employeeName,
      headCard: head?.card || "",
      memberCount: members.length,
      claimCount: groupedClaims.length,
      batches: [...new Set(groupedClaims.map((claim) => claim.batch))].sort((a, b) => a - b).join("، "),
      totalExamination: groupedClaims.reduce((sum, claim) => sum + claim.examination, 0),
      totalMedicines: groupedClaims.reduce((sum, claim) => sum + claim.medicines, 0),
      totalInvoice,
      familyRemaining,
      deficit: Math.max(0, totalInvoice - familyRemaining),
      surplus: Math.max(0, familyRemaining - totalInvoice),
      coverage: familyRemaining >= totalInvoice ? "مغطاة" : "غير مغطاة",
    });
  }
  families.sort((a, b) => b.deficit - a.deficit || Number(a.familyKey) - Number(b.familyKey));

  for (const claim of claims) {
    const beneficiaryTotal = claim.card
      ? cardClaims.get(claim.card).reduce((sum, item) => sum + item.invoiceTotal, 0)
      : null;
    const familySummary = claim.familyKey ? families.find((item) => item.familyKey === claim.familyKey) : null;
    claim.beneficiaryClaimsTotal = beneficiaryTotal;
    claim.beneficiaryCoverage = claim.card
      ? claim.beneficiaryRemaining >= beneficiaryTotal
        ? "مغطى من رصيد المستفيد"
        : "غير مغطى من رصيد المستفيد"
      : "غير قابل للتحقق";
    claim.familyRemaining = familySummary?.familyRemaining ?? null;
    claim.familyClaimsTotal = familySummary?.totalInvoice ?? null;
    claim.familyCoverage = familySummary?.coverage || "غير قابل للتحقق";
  }
  return families;
}

const CLAIM_COLUMNS = [
  { header: "اسم المستفيد", key: "beneficiaryName", width: 34 },
  { header: "رقم البطاقة", key: "card", width: 23 },
  { header: "الكشف", key: "examination", width: 12 },
  { header: "الأدوية", key: "medicines", width: 12 },
  { header: "إجمالي الفاتورة", key: "invoiceTotal", width: 17 },
  { header: "الدفعة", key: "batch", width: 10 },
  { header: "اسم الموظف في المصدر", key: "employeeName", width: 30 },
  { header: "الرقم الوظيفي", key: "employeeNumber", width: 16 },
  { header: "اسم المستفيد في المصدر", key: "beneficiaryInput", width: 30 },
  { header: "صلة القرابة", key: "relation", width: 16 },
  { header: "تاريخ الكشف", key: "examinationDate", width: 17 },
  { header: "تاريخ الأدوية", key: "medicineDate", width: 17 },
  { header: "نوع الأدوية", key: "medicineType", width: 18 },
  { header: "الرصيد المتبقي للمستفيد", key: "beneficiaryRemaining", width: 24 },
  { header: "إجمالي حسميات المستفيد", key: "beneficiaryClaimsTotal", width: 23 },
  { header: "كفاية رصيد المستفيد", key: "beneficiaryCoverage", width: 28 },
  { header: "الرصيد المتبقي للعائلة", key: "familyRemaining", width: 23 },
  { header: "إجمالي حسميات العائلة", key: "familyClaimsTotal", width: 22 },
  { header: "كفاية رصيد العائلة", key: "familyCoverage", width: 22 },
  { header: "طريقة مطابقة العائلة", key: "familyMatchMethod", width: 28 },
  { header: "ثقة مطابقة العائلة", key: "familyConfidence", width: 20 },
  { header: "طريقة مطابقة المستفيد", key: "personMatchMethod", width: 38 },
  { header: "ثقة مطابقة المستفيد", key: "personConfidence", width: 22 },
  { header: "اعتماد يدوي للعائلة", key: "manualFamilyConfirmed", width: 21 },
  { header: "سبب عدم التحقق", key: "unverifiedReason", width: 55 },
  { header: "صف المصدر", key: "sourceRow", width: 12 },
];

async function loadExecutedCashClaimInvoiceIds(prisma) {
  if (!prisma) return new Set();
  const rows = await prisma.transaction.findMany({
    where: { idempotency_key: { startsWith: "cash-claim-import:" }, is_cancelled: false },
    select: { idempotency_key: true },
  });
  const invoiceIds = new Set();
  for (const row of rows) {
    const match = String(row.idempotency_key || "").match(/^cash-claim-import:(CC-\d+-\d+):/);
    if (match) invoiceIds.add(match[1]);
  }
  return invoiceIds;
}

const FAMILY_COLUMNS = [
  { header: "اسم صاحب البطاقة", key: "headName", width: 34 },
  { header: "رقم بطاقة العائلة", key: "headCard", width: 23 },
  { header: "الرقم الوظيفي", key: "familyKey", width: 16 },
  { header: "عدد أفراد العائلة", key: "memberCount", width: 19 },
  { header: "عدد الفواتير", key: "claimCount", width: 15 },
  { header: "الدفعات", key: "batches", width: 22 },
  { header: "إجمالي الكشف", key: "totalExamination", width: 17 },
  { header: "إجمالي الأدوية", key: "totalMedicines", width: 17 },
  { header: "إجمالي الفاتورة", key: "totalInvoice", width: 18 },
  { header: "مجموع الرصيد المتبقي للعائلة", key: "familyRemaining", width: 30 },
  { header: "قيمة المستحق منهم (العجز)", key: "deficit", width: 29 },
  { header: "الفائض بعد الخصم", key: "surplus", width: 20 },
  { header: "حالة التغطية", key: "coverage", width: 18 },
];

const MOVEMENT_COLUMNS = [
  { header: "معرف الحركة", key: "movementId", width: 24 },
  { header: "معرف الفاتورة", key: "invoiceId", width: 20 },
  { header: "نوع الخدمة", key: "serviceType", width: 16 },
  { header: "رقم البطاقة", key: "card", width: 23 },
  { header: "اسم المستفيد", key: "beneficiaryName", width: 34 },
  { header: "المبلغ", key: "amount", width: 14 },
  { header: "قيمة بند الفاتورة", key: "componentInvoiceTotal", width: 20 },
  { header: "إجمالي الفاتورة", key: "fullInvoiceTotal", width: 18 },
  { header: "رقم بطاقة العائلة", key: "familyCard", width: 23 },
  { header: "اسم صاحب البطاقة", key: "familyHeadName", width: 34 },
  { header: "الرصيد قبل الحركة", key: "balanceBefore", width: 20 },
  { header: "الرصيد بعد الحركة", key: "balanceAfter", width: 20 },
  { header: "الدفعة", key: "batch", width: 10 },
  { header: "صف المصدر", key: "sourceRow", width: 12 },
  { header: "تاريخ الخدمة", key: "serviceDate", width: 18 },
  { header: "نوع الدواء", key: "medicineType", width: 18 },
  { header: "اسم الموظف في المصدر", key: "sourceEmployeeName", width: 30 },
  { header: "الرقم الوظيفي", key: "employeeNumber", width: 16 },
  { header: "اسم المريض في المصدر", key: "sourcePatientName", width: 30 },
  { header: "صلة القرابة", key: "relation", width: 16 },
  { header: "طريقة التوزيع", key: "allocationMethod", width: 35 },
];

const MOVEMENT_CHECK_COLUMNS = [
  { header: "معرف الفاتورة", key: "invoiceId", width: 20 },
  { header: "نوع الخدمة", key: "serviceType", width: 16 },
  { header: "الدفعة", key: "batch", width: 10 },
  { header: "صف المصدر", key: "sourceRow", width: 12 },
  { header: "قيمة بند الفاتورة", key: "invoiceAmount", width: 20 },
  { header: "مجموع الحركات الموزعة", key: "allocatedAmount", width: 25 },
  { header: "الفرق", key: "difference", width: 14 },
  { header: "عدد أفراد التوزيع", key: "allocationCount", width: 21 },
  { header: "حالة التحقق", key: "status", width: 18 },
];

const EXCLUDED_COLUMNS = [
  { header: "معرف الفاتورة", key: "invoiceId", width: 20 },
  { header: "الدفعة", key: "batch", width: 10 },
  { header: "صف المصدر", key: "sourceRow", width: 12 },
  { header: "اسم الموظف", key: "employeeName", width: 32 },
  { header: "الرقم الوظيفي", key: "employeeNumber", width: 16 },
  { header: "اسم المريض في المصدر", key: "beneficiaryInput", width: 30 },
  { header: "الكشف", key: "examination", width: 13 },
  { header: "الأدوية", key: "medicines", width: 13 },
  { header: "إجمالي الفاتورة", key: "invoiceTotal", width: 18 },
  { header: "رصيد العائلة وقت الفاتورة", key: "availableFamilyBalance", width: 27 },
  { header: "قيمة العجز", key: "deficit", width: 16 },
  { header: "سبب الاستبعاد", key: "reason", width: 45 },
];

function toCents(value) {
  return Math.round(Number(value || 0) * 100);
}

function fromCents(value) {
  return Number((value / 100).toFixed(2));
}

function balancedAllocationWithCaps(amountCents, memberStates) {
  if (amountCents <= 0) return [];
  const eligible = memberStates
    .filter((member) => member.balanceCents > 0)
    .sort((a, b) => a.card.localeCompare(b.card));
  const totalBalanceCents = eligible.reduce((sum, member) => sum + member.balanceCents, 0);
  if (totalBalanceCents < amountCents) return [];

  const shares = eligible.map((member) => ({ member, amountCents: 0 }));
  let active = [...shares];
  let remainingCents = amountCents;

  // توزيع متساوٍ مع سقف رصيد الفرد (water-filling): كل فرد يأخذ الحصة
  // المتساوية ما دام رصيده يسمح، ومن لا يكفي رصيده يؤخذ المتاح منه ثم
  // يعاد توزيع الفرق بالكامل على بقية أفراد العائلة.
  while (remainingCents > 0 && active.length > 0) {
    const equalShare = Math.floor(remainingCents / active.length);
    const capped = active.filter((share) => {
      const capacity = share.member.balanceCents - share.amountCents;
      return capacity <= equalShare;
    });

    if (capped.length > 0) {
      for (const share of capped) {
        const capacity = share.member.balanceCents - share.amountCents;
        share.amountCents += capacity;
        remainingCents -= capacity;
      }
      const cappedSet = new Set(capped);
      active = active.filter((share) => !cappedSet.has(share));
      continue;
    }

    for (const share of active) {
      share.amountCents += equalShare;
      remainingCents -= equalShare;
    }

    // تسوية السنتات المتبقية على أصحاب أعلى سعة متبقية، بترتيب ثابت.
    const remainderOrder = [...active].sort((a, b) => {
      const aCapacity = a.member.balanceCents - a.amountCents;
      const bCapacity = b.member.balanceCents - b.amountCents;
      return bCapacity - aCapacity || a.member.card.localeCompare(b.member.card);
    });
    for (const share of remainderOrder) {
      if (remainingCents <= 0) break;
      if (share.amountCents < share.member.balanceCents) {
        share.amountCents += 1;
        remainingCents -= 1;
      }
    }
  }

  return shares.filter((share) => share.amountCents > 0);
}

function simulateCashClaimMovements(claims, registry) {
  const familyStates = new Map();
  for (const [familyKey, members] of registry.families.entries()) {
    familyStates.set(familyKey, members.map((member) => ({
      ...member,
      balanceCents: toCents(member.remainingBalance),
    })));
  }

  const movements = { GENERAL: [], MEDICINE: [] };
  const checks = { GENERAL: [], MEDICINE: [] };
  const excluded = [];

  for (const claim of claims) {
    const invoiceId = `CC-${claim.batch}-${claim.sourceRow}`;
    const familyMembers = claim.familyKey ? familyStates.get(claim.familyKey) : null;
    const fullInvoiceCents = toCents(claim.examination) + toCents(claim.medicines);
    const availableFamilyCents = familyMembers
      ? familyMembers.reduce((sum, member) => sum + member.balanceCents, 0)
      : 0;

    if (!familyMembers?.length || availableFamilyCents < fullInvoiceCents) {
      const deficitCents = Math.max(0, fullInvoiceCents - availableFamilyCents);
      excluded.push({
        invoiceId,
        ...claim,
        availableFamilyBalance: fromCents(availableFamilyCents),
        deficit: fromCents(deficitCents),
        reason: !familyMembers?.length
          ? "العائلة غير مطابقة في ملف المستفيدين — لم تُنشأ أي حركة"
          : "رصيد العائلة المتبقي وقت الفاتورة لا يغطي كامل الفاتورة — لم يُنفذ خصم جزئي",
      });
      continue;
    }

    const head = familyMembers.find((member) => member.relation === "MAIN");
    const components = [
      { serviceType: "GENERAL", amountCents: toCents(claim.examination), serviceDate: claim.examinationDate },
      { serviceType: "MEDICINE", amountCents: toCents(claim.medicines), serviceDate: claim.medicineDate },
    ];

    for (const component of components) {
      if (component.amountCents <= 0) continue;
      const shares = balancedAllocationWithCaps(component.amountCents, familyMembers);
      let allocatedCents = 0;

      for (let index = 0; index < shares.length; index += 1) {
        const share = shares[index];
        const beforeCents = share.member.balanceCents;
        share.member.balanceCents -= share.amountCents;
        allocatedCents += share.amountCents;
        movements[component.serviceType].push({
          movementId: `${invoiceId}-${component.serviceType}-${String(index + 1).padStart(2, "0")}`,
          invoiceId,
          serviceType: component.serviceType,
          card: share.member.card,
          beneficiaryName: share.member.name,
          amount: fromCents(share.amountCents),
          componentInvoiceTotal: fromCents(component.amountCents),
          fullInvoiceTotal: fromCents(fullInvoiceCents),
          familyCard: head?.card || `WAB2025${claim.familyKey}`,
          familyHeadName: head?.name || claim.employeeName,
          balanceBefore: fromCents(beforeCents),
          balanceAfter: fromCents(share.member.balanceCents),
          batch: claim.batch,
          sourceRow: claim.sourceRow,
          serviceDate: component.serviceDate,
          medicineType: component.serviceType === "MEDICINE" ? claim.medicineType : "",
          sourceEmployeeName: claim.employeeName,
          employeeNumber: claim.employeeNumber,
          sourcePatientName: claim.beneficiaryInput,
          relation: claim.relation,
          allocationMethod: "متساوٍ مع سقف رصيد الفرد وإعادة توزيع العجز على بقية العائلة",
        });
      }

      checks[component.serviceType].push({
        invoiceId,
        serviceType: component.serviceType,
        batch: claim.batch,
        sourceRow: claim.sourceRow,
        invoiceAmount: fromCents(component.amountCents),
        allocatedAmount: fromCents(allocatedCents),
        difference: fromCents(component.amountCents - allocatedCents),
        allocationCount: shares.length,
        status: allocatedCents === component.amountCents ? "متطابق" : "خطأ توزيع",
      });
    }
  }

  return { movements, checks, excluded };
}

function styleSheet(sheet) {
  sheet.views = [{ rightToLeft: true, state: "frozen", ySplit: 1 }];
  sheet.autoFilter = { from: "A1", to: sheet.getRow(1).getCell(sheet.columnCount).address };
  const header = sheet.getRow(1);
  header.height = 26;
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E78" } };
  header.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber > 1) row.alignment = { vertical: "middle", wrapText: true };
  });
  for (const key of ["examination", "medicines", "invoiceTotal", "beneficiaryRemaining", "beneficiaryClaimsTotal", "familyRemaining", "familyClaimsTotal", "totalExamination", "totalMedicines", "totalInvoice", "deficit", "surplus", "amount", "componentInvoiceTotal", "fullInvoiceTotal", "balanceBefore", "balanceAfter", "invoiceAmount", "allocatedAmount", "difference", "availableFamilyBalance"]) {
    const column = sheet.columns.find((item) => item.key === key);
    if (column) column.numFmt = '#,##0.00';
  }
}

async function writeWorkbook(filePath, sheets) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Codex - WAAD";
  workbook.created = new Date();
  for (const definition of sheets) {
    const sheet = workbook.addWorksheet(definition.name);
    sheet.columns = definition.columns;
    sheet.addRows(definition.rows);
    styleSheet(sheet);
  }
  await workbook.xlsx.writeFile(filePath);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.registryFromDb && !fs.existsSync(options.registryFile)) {
    throw new Error(`ملف المستفيدين غير موجود: ${options.registryFile}`);
  }
  fs.mkdirSync(options.outputDir, { recursive: true });
  const prisma = options.registryFromDb ? new PrismaClient() : null;
  try {
    const registry = options.registryFromDb
      ? await loadRegistryFromDatabase(prisma)
      : await loadRegistryFromExcel(options.registryFile);
    const allClaims = await readClaims(registry);
    const executedInvoiceIds = await loadExecutedCashClaimInvoiceIds(prisma);
    const claims = allClaims.filter((claim) => !executedInvoiceIds.has(`CC-${claim.batch}-${claim.sourceRow}`));
    const families = calculateSummaries(claims, registry);
    const cashClaimImport = simulateCashClaimMovements(claims, registry);

    for (const batch of BATCHES) {
      await writeWorkbook(path.join(options.outputDir, `حسميات منظمة - دفعة ${batch}.xlsx`), [
      { name: `دفعة ${batch}`, columns: CLAIM_COLUMNS, rows: claims.filter((claim) => claim.batch === batch) },
      ]);
    }

    const unmatched = claims.filter((claim) =>
      !claim.manualFamilyConfirmed && (!claim.card || claim.personConfidence === "تحتاج مراجعة"),
    );
    const insufficientFamilies = families.filter((family) => family.coverage === "غير مغطاة");
    const unmatchedFamilies = claims.filter((claim) => !claim.familyKey);
    await writeWorkbook(path.join(options.outputDir, "تقرير الحسميات المجمع.xlsx"), [
    { name: "كل الحسميات", columns: CLAIM_COLUMNS, rows: claims },
    { name: "ملخص العائلات", columns: FAMILY_COLUMNS, rows: families },
    { name: "مطابقات تحتاج مراجعة", columns: CLAIM_COLUMNS, rows: unmatched },
  ]);
    await writeWorkbook(path.join(options.outputDir, "العائلات غير المغطية لقيمة الفاتورة.xlsx"), [
    { name: "العائلات غير المغطاة", columns: FAMILY_COLUMNS, rows: insufficientFamilies },
  ]);
    await writeWorkbook(path.join(options.outputDir, "حسميات غير قابلة للتحقق.xlsx"), [
    { name: "مستفيد غير مطابق", columns: CLAIM_COLUMNS, rows: unmatched },
    { name: "عائلة غير مطابقة", columns: CLAIM_COLUMNS, rows: unmatchedFamilies },
    ]);
    await writeWorkbook(path.join(options.outputDir, "لم يتم التحقق.xlsx"), [
      { name: "لم يتم التحقق", columns: CLAIM_COLUMNS, rows: unmatched },
    ]);
    await writeWorkbook(path.join(options.outputDir, "حركات Cash Claim - الكشوفات - توزيع متساوي.xlsx"), [
    { name: "الحركات", columns: MOVEMENT_COLUMNS, rows: cashClaimImport.movements.GENERAL },
    { name: "التحقق", columns: MOVEMENT_CHECK_COLUMNS, rows: cashClaimImport.checks.GENERAL },
  ]);
    await writeWorkbook(path.join(options.outputDir, "حركات Cash Claim - الأدوية - توزيع متساوي.xlsx"), [
    { name: "الحركات", columns: MOVEMENT_COLUMNS, rows: cashClaimImport.movements.MEDICINE },
    { name: "التحقق", columns: MOVEMENT_CHECK_COLUMNS, rows: cashClaimImport.checks.MEDICINE },
  ]);
    await writeWorkbook(path.join(options.outputDir, "فواتير Cash Claim المستبعدة من الاستيراد.xlsx"), [
    { name: "فواتير مستبعدة", columns: EXCLUDED_COLUMNS, rows: cashClaimImport.excluded },
  ]);

    const highConfidence = claims.filter((claim) => claim.card && claim.personConfidence === "عالية").length;
    const mediumConfidence = claims.filter((claim) => claim.card && claim.personConfidence === "متوسطة").length;
    console.log(JSON.stringify({
    registrySource: options.registryFromDb ? "DATABASE_CURRENT" : options.registryFile,
    sourceClaims: allClaims.length,
    executedInvoicesExcluded: executedInvoiceIds.size,
    registryMembers: registry.members.length,
    registryFamilies: registry.families.size,
    pendingClaims: claims.length,
    totalClaimValue: claims.reduce((sum, claim) => sum + claim.invoiceTotal, 0),
    highConfidence,
    mediumConfidence,
    unmatched: unmatched.length,
    unmatchedFamilies: unmatchedFamilies.length,
    matchedFamilies: families.length,
    insufficientFamilies: insufficientFamilies.length,
    totalDeficit: insufficientFamilies.reduce((sum, family) => sum + family.deficit, 0),
    generalMovementRows: cashClaimImport.movements.GENERAL.length,
    medicineMovementRows: cashClaimImport.movements.MEDICINE.length,
    excludedInvoices: cashClaimImport.excluded.length,
    generalAllocatedTotal: cashClaimImport.movements.GENERAL.reduce((sum, row) => sum + row.amount, 0),
    medicineAllocatedTotal: cashClaimImport.movements.MEDICINE.reduce((sum, row) => sum + row.amount, 0),
    outputDir: options.outputDir,
    }, null, 2));
  } finally {
    if (prisma) await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
