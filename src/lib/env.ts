/**
 * التحقق من متغيرات البيئة المطلوبة عند بدء التشغيل.
 * يُستدعى من layout.tsx لضمان فحص مبكر.
 */

const REQUIRED_VARS = [
  "DATABASE_URL",
  "JWT_SECRET",
  "BACKUP_ENCRYPTION_KEY",
  "BENEFICIARY_TOKEN_SECRET",
] as const;

const OPTIONAL_VARS = [
  "REDIS_URL",
  "WAAD_FACILITY_ID",
  "ADMIN_SEED_PASSWORD",
  "INITIAL_BALANCE",
  "BENEFICIARY_JWT_SECRET",
] as const;

const PLACEHOLDER_PATTERNS = ["replace-with", "changeme", "placeholder", "your-secret"];

let _validated = false;

export function validateEnv() {
  if (_validated) return;
  _validated = true;

  const isProduction = process.env.NODE_ENV === "production";
  const missing: string[] = [];

  for (const key of REQUIRED_VARS) {
    if (!process.env[key]?.trim()) {
      missing.push(key);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `❌ متغيرات البيئة التالية مطلوبة ولم يتم تعيينها:\n${missing.map(k => `   - ${k}`).join("\n")}\n\nراجع ملف .env.example للتفاصيل.`
    );
  }

  // التحقق من أن الأسرار ليست قيم placeholder
  const secretVars = ["JWT_SECRET", "BACKUP_ENCRYPTION_KEY", "BENEFICIARY_TOKEN_SECRET"] as const;
  for (const key of secretVars) {
    const val = process.env[key] ?? "";
    if (PLACEHOLDER_PATTERNS.some((p) => val.toLowerCase().includes(p))) {
      if (isProduction) {
        throw new Error(`❌ ${key} يحتوي على قيمة placeholder — يجب استبداله بقيمة عشوائية قبل الإنتاج`);
      } else {
        console.warn(`⚠️  ${key} يحتوي على قيمة placeholder — لا تستخدمه في الإنتاج`);
      }
    }
  }

  // فحص طول JWT_SECRET
  const jwtLen = (process.env.JWT_SECRET ?? "").length;
  if (jwtLen < 32) {
    console.warn("⚠️  JWT_SECRET قصير جداً — يُنصح باستخدام 64 حرفاً على الأقل");
  }

  // BENEFICIARY_JWT_SECRET: إجباري في الإنتاج
  if (isProduction && !process.env.BENEFICIARY_JWT_SECRET?.trim()) {
    throw new Error("❌ BENEFICIARY_JWT_SECRET مطلوب في بيئة الإنتاج — لا يجوز استخدام JWT_SECRET كبديل");
  }

  // التحقق من أن BENEFICIARY_JWT_SECRET مختلف عن JWT_SECRET
  if (process.env.BENEFICIARY_JWT_SECRET && process.env.BENEFICIARY_JWT_SECRET === process.env.JWT_SECRET) {
    console.warn("⚠️  BENEFICIARY_JWT_SECRET مطابق لـ JWT_SECRET — يُنصح باستخدام مفتاح مختلف لمنع Token Substitution");
  }

  // Redis إجباري في الإنتاج
  if (isProduction && !process.env.REDIS_URL?.trim()) {
    console.warn("🔴 REDIS_URL غير معيّن في الإنتاج — Rate Limiting لن يعمل بشكل صحيح مع عدة instances");
  }

  for (const key of OPTIONAL_VARS) {
    if (!process.env[key]?.trim()) {
      switch (key) {
        case "REDIS_URL":
          if (!isProduction) console.warn("⚠️  REDIS_URL غير معيّن — سيتم استخدام الذاكرة المحلية لـ Rate Limiting و SSE");
          break;
        case "WAAD_FACILITY_ID":
          console.warn("⚠️  WAAD_FACILITY_ID غير معيّن — سيتعطل استيراد المعاملات إذا استُخدم");
          break;
        default:
          break;
      }
    }
  }
}
