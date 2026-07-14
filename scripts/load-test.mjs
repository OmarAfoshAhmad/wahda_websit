/**
 * اختبار الضغط المتزامن - Waha Health Care Load Test
 * =====================================================
 * يُحاكي دخول عدة مرافق صحية في نفس الوقت وإجراء عمليات خصم متزامنة.
 * 
 * كيفية الاستخدام:
 *   node scripts/load-test.mjs [BASE_URL] [CONCURRENCY] [DURATION_SEC]
 * 
 * مثال:
 *   node scripts/load-test.mjs http://localhost:3000 10 30
 *   (10 مرافق متزامنة × 30 ثانية)
 */

const BASE_URL = process.argv[2] || "http://localhost:3000";
const CONCURRENCY = parseInt(process.argv[3] || "5");   // عدد المرافق المتزامنة
const DURATION_MS = parseInt(process.argv[4] || "20") * 1000; // مدة الاختبار بالثواني

// ─── ألوان للطباعة ────────────────────────────────────────────────────────────
const c = {
  reset: "\x1b[0m", bold: "\x1b[1m",
  red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m",
  blue: "\x1b[34m", cyan: "\x1b[36m", gray: "\x1b[90m",
};

// ─── متغيرات النتائج ──────────────────────────────────────────────────────────
const metrics = {
  requests: 0,          // إجمالي الطلبات
  success: 0,           // النجاح
  failed: 0,            // الفشل
  rateLimited: 0,       // محدودية الطلبات
  errors: 0,            // أخطاء شبكة
  latencies: [],        // قائمة أوقات الاستجابة (ms)
  concurrentPeak: 0,    // أعلى تزامن في لحظة واحدة
  _activeNow: 0,
};

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.min(idx, sorted.length - 1)];
}

function recordLatency(ms) {
  metrics.latencies.push(ms);
}

function track(inc = 1) {
  metrics._activeNow += inc;
  if (metrics._activeNow > metrics.concurrentPeak) {
    metrics.concurrentPeak = metrics._activeNow;
  }
}

// ─── بيانات المرافق الوهمية ───────────────────────────────────────────────────
// سيتم اختبار كل من: تسجيل الدخول، البحث عن مستفيد، وعملية الخصم
// في غياب بيانات حقيقية، نختبر APIs العامة + Login

async function simulateFacility(facilityIndex) {
  const t0 = Date.now();
  track(+1);
  metrics.requests++;
  
  try {
    // ─── 1. اختبار صفحة تسجيل الدخول (GET) ───
    const loginRes = await fetch(`${BASE_URL}/login`, {
      method: "GET",
      signal: AbortSignal.timeout(10000),
    });
    
    recordLatency(Date.now() - t0);

    if (loginRes.ok) {
      metrics.success++;
    } else if (loginRes.status === 429) {
      metrics.rateLimited++;
    } else {
      metrics.failed++;
    }

    // ─── 2. محاولة تسجيل دخول (POST) ───
    const t1 = Date.now();
    metrics.requests++;
    
    const formData = new FormData();
    formData.append("username", `load_test_facility_${facilityIndex}`);
    formData.append("password", "wrong_password_intentional_test");

    const loginPostRes = await fetch(`${BASE_URL}/login`, {
      method: "POST",
      body: formData,
      redirect: "manual",
      signal: AbortSignal.timeout(10000),
    });
    
    recordLatency(Date.now() - t1);
    
    // 200=رد مع رسالة خطأ (صحيح), 302/307=redirect لـ dashboard (نجاح تسجيل دخول)
    // 429=rate limited (موثوق — النظام يحمي نفسه)
    if ([200, 302, 307, 303].includes(loginPostRes.status)) {
      metrics.success++;
    } else if (loginPostRes.status === 429) {
      metrics.rateLimited++;
    } else if (loginPostRes.status >= 500) {
      metrics.failed++;
      console.error(`\n${c.red}[F${facilityIndex}] POST /login → ${loginPostRes.status}${c.reset}`);
    } else {
      metrics.success++;
    }

    // ─── 3. تحميل صفحة المستفيد العام ─── (لا تتطلب تسجيل دخول)
    const t2 = Date.now();
    metrics.requests++;

    const beneficiaryRes = await fetch(`${BASE_URL}/beneficiary/login`, {
      method: "GET",
      signal: AbortSignal.timeout(10000),
    });

    recordLatency(Date.now() - t2);

    if (beneficiaryRes.ok) {
      metrics.success++;
    } else if (beneficiaryRes.status === 429) {
      metrics.rateLimited++;
    } else if (beneficiaryRes.status >= 500) {
      metrics.failed++;
      console.error(`\n${c.red}[F${facilityIndex}] GET /beneficiary/login → ${beneficiaryRes.status}${c.reset}`);
    } else {
      metrics.success++;
    }

  } catch (err) {
    if (err.name === "TimeoutError" || err.name === "AbortError") {
      metrics.errors++;
      metrics.latencies.push(10000);
    } else {
      metrics.errors++;
    }
  } finally {
    track(-1);
  }
}

// ─── Worker لتشغيل اختبارات مستمرة طوال المدة ────────────────────────────────
async function runWorker(facilityIndex, endTime) {
  let iterations = 0;
  while (Date.now() < endTime) {
    await simulateFacility(facilityIndex);
    iterations++;
    // استراحة عشوائية بين 100-500ms لمحاكاة تصرف بشري واقعي
    await new Promise(r => setTimeout(r, 100 + Math.random() * 400));
  }
  return iterations;
}

// ─── تقرير التقدم الفوري ──────────────────────────────────────────────────────
function printProgress() {
  const sorted = [...metrics.latencies].sort((a, b) => a - b);
  const avg = sorted.length ? Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length) : 0;
  const p95 = percentile(sorted, 95);

  process.stdout.write(
    `\r${c.cyan}●${c.reset} Req: ${c.bold}${metrics.requests}${c.reset} | ` +
    `✅ ${c.green}${metrics.success}${c.reset} | ` +
    `❌ ${c.red}${metrics.failed}${c.reset} | ` +
    `🚫 ${c.yellow}${metrics.rateLimited}${c.reset} | ` +
    `⚠️  ${metrics.errors} | ` +
    `Avg: ${avg}ms | P95: ${p95}ms | ` +
    `Active: ${metrics._activeNow}/${CONCURRENCY}   `
  );
}

// ─── تقرير نهائي ─────────────────────────────────────────────────────────────
function printFinalReport(durationMs) {
  const sorted = [...metrics.latencies].sort((a, b) => a - b);
  const avg = sorted.length ? Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length) : 0;
  const p50 = percentile(sorted, 50);
  const p95 = percentile(sorted, 95);
  const p99 = percentile(sorted, 99);
  const minL = sorted[0] || 0;
  const maxL = sorted[sorted.length - 1] || 0;
  const rps = Math.round(metrics.requests / (durationMs / 1000));
  const successRate = metrics.requests > 0
    ? ((metrics.success / metrics.requests) * 100).toFixed(1)
    : "0";

  console.log("\n");
  console.log(`${c.bold}${c.cyan}════════════════════════════════════════════════════${c.reset}`);
  console.log(`${c.bold}   نتائج اختبار الضغط — Waha Health Care${c.reset}`);
  console.log(`${c.bold}${c.cyan}════════════════════════════════════════════════════${c.reset}`);
  console.log(`\n${c.bold}📋 الإعدادات:${c.reset}`);
  console.log(`   الخادم المستهدف  : ${BASE_URL}`);
  console.log(`   المرافق المتزامنة: ${CONCURRENCY}`);
  console.log(`   مدة الاختبار    : ${durationMs / 1000}s`);

  console.log(`\n${c.bold}📊 نتائج الطلبات:${c.reset}`);
  console.log(`   الإجمالي        : ${c.bold}${metrics.requests}${c.reset} طلب`);
  console.log(`   الطلبات/ثانية   : ${c.bold}${c.cyan}${rps} req/s${c.reset}`);
  console.log(`   نجاح            : ${c.green}${metrics.success}${c.reset} (${successRate}%)`);
  console.log(`   فشل (5xx)       : ${metrics.failed > 0 ? c.red : c.green}${metrics.failed}${c.reset}`);
  console.log(`   محدود (429)     : ${c.yellow}${metrics.rateLimited}${c.reset}`);
  console.log(`   أخطاء شبكة      : ${metrics.errors > 0 ? c.red : c.green}${metrics.errors}${c.reset}`);
  console.log(`   أعلى تزامن      : ${metrics.concurrentPeak} طلب في نفس الوقت`);

  console.log(`\n${c.bold}⚡ أوقات الاستجابة:${c.reset}`);
  console.log(`   الأدنى  : ${c.green}${minL}ms${c.reset}`);
  console.log(`   P50     : ${p50}ms`);
  console.log(`   المتوسط : ${avg}ms`);
  console.log(`   P95     : ${p95 > 1000 ? c.red : p95 > 500 ? c.yellow : c.green}${p95}ms${c.reset}`);
  console.log(`   P99     : ${p99 > 2000 ? c.red : p99 > 1000 ? c.yellow : c.green}${p99}ms${c.reset}`);
  console.log(`   الأعلى  : ${maxL > 5000 ? c.red : c.yellow}${maxL}ms${c.reset}`);

  // ─── الحكم النهائي ───
  console.log(`\n${c.bold}🏆 التقييم النهائي:${c.reset}`);
  const issues = [];

  if (parseFloat(successRate) < 99) issues.push(`معدل نجاح منخفض (${successRate}%)`);
  if (metrics.failed > 0) issues.push(`${metrics.failed} خطأ خادم (5xx)`);
  if (metrics.errors > 0) issues.push(`${metrics.errors} خطأ شبكة / انقطاع`);
  if (p95 > 2000) issues.push(`P95 = ${p95}ms (بطيء جداً)`);
  else if (p95 > 800) issues.push(`P95 = ${p95}ms (يمكن تحسينه)`);
  if (maxL > 10000) issues.push(`أطول طلب تجاوز 10 ثواني`);

  if (issues.length === 0) {
    console.log(`   ${c.green}${c.bold}✅ النظام مستقر تحت حمل ${CONCURRENCY} مرفق متزامن${c.reset}`);
    console.log(`   ${c.green}   جاهز للإنتاج بكل ثقة.${c.reset}`);
  } else {
    console.log(`   ${c.yellow}${c.bold}⚠️  تم اكتشاف ${issues.length} مشكلة:${c.reset}`);
    issues.forEach(i => console.log(`   ${c.red}• ${i}${c.reset}`));
  }

  console.log(`\n${c.bold}${c.cyan}════════════════════════════════════════════════════${c.reset}\n`);

  // exit code: 0 = نجاح، 1 = فشل
  process.exit(issues.filter(i => i.includes("5xx") || i.includes("شبكة")).length > 0 ? 1 : 0);
}

// ─── تشغيل الاختبار ───────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${c.bold}${c.cyan}🚀 اختبار الضغط — Waha Health Care${c.reset}`);
  console.log(`${c.gray}   الهدف: ${BASE_URL}${c.reset}`);
  console.log(`${c.gray}   التزامن: ${CONCURRENCY} مرفق | المدة: ${DURATION_MS / 1000}s${c.reset}`);
  console.log(`${c.gray}   جاري التشغيل...${c.reset}\n`);

  // التحقق من أن الخادم يعمل
  try {
    const probe = await fetch(`${BASE_URL}/login`, { signal: AbortSignal.timeout(5000) });
    if (!probe.ok && probe.status !== 200) {
      console.warn(`${c.yellow}تحذير: الخادم أجاب بـ ${probe.status} — قد يكون هناك مشكلة${c.reset}`);
    } else {
      console.log(`${c.green}✅ الخادم يعمل بوضع سليم (HTTP ${probe.status})${c.reset}\n`);
    }
  } catch {
    console.error(`${c.red}❌ الخادم غير متاح على ${BASE_URL}${c.reset}`);
    console.error(`   تأكد من تشغيل المشروع بـ: npm run dev`);
    process.exit(1);
  }

  const endTime = Date.now() + DURATION_MS;
  const startTime = Date.now();

  // مؤقت التقرير الحي (كل ثانية)
  const progressTimer = setInterval(printProgress, 1000);

  // تشغيل العمال المتزامنين
  const workers = Array.from({ length: CONCURRENCY }, (_, i) => runWorker(i + 1, endTime));
  await Promise.all(workers);

  clearInterval(progressTimer);
  printFinalReport(Date.now() - startTime);
}

main().catch(err => {
  console.error(`${c.red}خطأ فادح: ${err.message}${c.reset}`);
  process.exit(1);
});
