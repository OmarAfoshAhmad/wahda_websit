/**
 * يحقن قواعد تغطية الأدوية (العيادات الخارجية فقط) من ملفات "قواعد_تغطية_*" في سياسات الصيدلية.
 *
 * الربط:
 *   CAT-DRUG-GENERAL  (OUTPATIENT) → روتيني
 *   CAT-DRUG-CHRONIC  (OUTPATIENT) → مزمن
 *   CAT-ONCOLOGY      (OUTPATIENT) → كيميائي (الأورام): التغطية دائمًا 100%، والسقف من الملف إن وُجد
 *   إن غاب بند الأدوية في الملف تُستخدم نسبة العيادات الخارجية العامة (CAT-COV-OUTPATIENT) بلا سقف للفئة.
 * صفوف الإيواء (INPATIENT) وصفوف "سياق القرار" (ولادة/مضاعفات) تُتجاهل.
 * السقف العام لخدمة الأدوية (ceiling_amount) لا يُمس.
 *
 * الاستخدام:
 *   node scripts/import-pharmacy-coverage-rules.mjs "<مجلد القواعد>"          # معاينة فقط
 *   node scripts/import-pharmacy-coverage-rules.mjs "<مجلد القواعد>" --apply  # تنفيذ
 */
import { readdirSync } from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import { PrismaClient } from "@prisma/client";

// اسم الملف (بعد حذف البادئة واللاحقة) → كود الشركة في المنظومة.
// توسيالي (ملفان: أجانب/صلب محلي) والنادي الليبي للسيارات (لا شركة مقابلة) مستبعدان حتى يُحسم أمرهما.
const FILE_TO_COMPANY = {
  "اركاديا": "ARCD",
  "الشركة_الليبية_للاسمنت": "LCC",
  "المنطقة_الحرة_جليانة": "JFZ",
  "الواحة": "WAHA",
  "اوزون_1": "O3G",
  "حجر_الماس_1": "HJR",
  "رواق": "RWG",
  "فيوتشر": "FUTU",
  "مصرف_الوحدة": "WAB",
  "مصلحة_الجمارك": "JMR",
  "وعد الطبية": "WAAD",
  "وعد_المعماري": "WCA",
};

const [folder, flag] = process.argv.slice(2);
if (!folder) {
  console.error('الاستخدام: node scripts/import-pharmacy-coverage-rules.mjs "<مجلد القواعد>" [--apply]');
  process.exit(1);
}
const apply = flag === "--apply";

const cellValue = (value) => (value && typeof value === "object" && "result" in value ? value.result : value);
const toNumber = (value) => {
  const v = cellValue(value);
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

async function readRules(file) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(file);
  const sheet = workbook.getWorksheet("المنافع");
  if (!sheet) throw new Error("لا توجد ورقة المنافع");
  const header = [];
  sheet.getRow(1).eachCell((cell, col) => { header[col] = String(cell.value ?? "").trim(); });
  const col = (name) => {
    const index = header.indexOf(name);
    if (index < 0) throw new Error(`عمود مفقود: ${name}`);
    return index;
  };
  const c = { code: col("كود التصنيف"), context: col("السياق"), coverage: col("نسبة التغطية"), ceiling: col("السقف المالي"), active: col("نشط"), decision: col("سياق القرار") };
  const rules = {};
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const get = (index) => cellValue(row.getCell(index).value);
    if (get(c.context) !== "OUTPATIENT" || get(c.decision) || String(get(c.active) ?? "نعم").trim() !== "نعم") return;
    const code = String(get(c.code) ?? "").trim();
    if (!rules[code]) rules[code] = { coverage: toNumber(get(c.coverage)), ceiling: toNumber(get(c.ceiling)) };
  });
  return rules;
}

function buildConfig(rules) {
  const general = rules["CAT-COV-OUTPATIENT"]?.coverage ?? null;
  const pick = (code) => rules[code] ?? (general === null ? null : { coverage: general, ceiling: null, fallback: true });
  const routine = pick("CAT-DRUG-GENERAL");
  const chronic = pick("CAT-DRUG-CHRONIC");
  const oncology = rules["CAT-ONCOLOGY"];
  return {
    general,
    routine,
    chronic,
    chemical: { coverage: 100, ceiling: oncology?.ceiling ?? null, fallback: !oncology },
  };
}

const prisma = new PrismaClient();
const files = readdirSync(folder).filter((name) => name.endsWith(".xlsx") && !name.startsWith("~$"));
const report = [];
for (const name of files) {
  const key = name.replace("قواعد_تغطية_", "").replace("_حسب_النظام_الجديد", "").replace(".xlsx", "").trim();
  const code = FILE_TO_COMPANY[key];
  if (!code) { report.push(`تخطي: ${key} (غير مربوط بشركة)`); continue; }
  const config = buildConfig(await readRules(path.join(folder, name)));
  if (!config.routine || !config.chronic) { report.push(`تخطي: ${key} (لا توجد نسبة أدوية ولا نسبة عيادات خارجية)`); continue; }

  const policy = await prisma.servicePolicy.findFirst({
    where: { company: { code }, service_type: { code: "MEDICINE" } },
    select: { id: true, company: { select: { name: true } }, pharmacy_config: { select: { id: true } } },
  });
  if (!policy?.pharmacy_config) { report.push(`تخطي: ${key} → ${code} (لا توجد سياسة صيدلية)`); continue; }

  const describe = (label, rule) => `${label} ${rule.coverage}%${rule.ceiling === null ? " بلا سقف" : ` سقف ${rule.ceiling}`}${rule.fallback ? " (من العيادات الخارجية)" : ""}`;
  report.push(`${policy.company.name}: ${describe("روتيني", config.routine)} | ${describe("مزمن", config.chronic)} | ${describe("كيميائي", config.chemical)}`);

  if (apply) {
    await prisma.$transaction([
      prisma.servicePolicy.update({ where: { id: policy.id }, data: { coverage_percent: config.general ?? config.routine.coverage } }),
      prisma.pharmacyPolicyConfig.update({
        where: { id: policy.pharmacy_config.id },
        data: {
          routine_enabled: config.routine.coverage > 0,
          routine_coverage_percent: config.routine.coverage,
          routine_ceiling: config.routine.ceiling,
          chronic_enabled: config.chronic.coverage > 0,
          chronic_coverage_percent: config.chronic.coverage,
          chronic_ceiling: config.chronic.ceiling,
          chemical_enabled: true,
          chemical_coverage_percent: 100,
          chemical_ceiling: config.chemical.ceiling,
        },
      }),
    ]);
  }
}
await prisma.$disconnect();
console.log(report.join("\n"));
console.log(apply ? "\nتم التنفيذ." : "\nمعاينة فقط. أضف --apply للتنفيذ.");
