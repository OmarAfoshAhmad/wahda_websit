/* eslint-disable @typescript-eslint/no-require-imports */
const path = require("path");
const XLSX = require("xlsx");

const jobs = [
  {
    input: "حركات Cash Claim - الكشوفات - توزيع متساوي.xlsx",
    output: "public/قالب_استيراد_Cash_Claim_الكشوفات.xlsx",
    expectedType: "GENERAL",
    serviceLabel: "كشف",
  },
  {
    input: "حركات Cash Claim - الأدوية - توزيع متساوي.xlsx",
    output: "public/قالب_استيراد_Cash_Claim_الأدوية.xlsx",
    expectedType: "MEDICINE",
    serviceLabel: "أدوية",
  },
];

function distributeIntegerEqually(target, sourceRows) {
  const allocations = sourceRows.map(() => 0);
  const caps = sourceRows.map((row) => Math.max(0, Math.floor(Number(row["الرصيد قبل الحركة"]) || 0)));
  let remaining = target;

  while (remaining > 0) {
    const active = allocations
      .map((allocated, index) => ({ index, capacity: caps[index] - allocated }))
      .filter((item) => item.capacity > 0);
    if (active.length === 0) throw new Error(`الرصيد المتاح لا يغطي المبلغ ${target}`);

    const equalShare = Math.max(1, Math.floor(remaining / active.length));
    let progressed = false;
    for (const item of active) {
      if (remaining <= 0) break;
      const amount = Math.min(equalShare, item.capacity, remaining);
      if (amount <= 0) continue;
      allocations[item.index] += amount;
      remaining -= amount;
      progressed = true;
    }
    if (!progressed) throw new Error("تعذر إكمال التوزيع الصحيح");
  }

  return allocations;
}

function generate(job) {
  const inputPath = path.resolve(process.cwd(), job.input);
  const outputPath = path.resolve(process.cwd(), job.output);
  const workbook = XLSX.readFile(inputPath, { raw: true });
  const sourceRows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: "", raw: true });
  const groups = new Map();

  for (const row of sourceRows) {
    const type = String(row["نوع الخدمة"] ?? "").trim().toUpperCase();
    if (type !== job.expectedType) throw new Error(`نوع خدمة غير متوقع في ${job.input}: ${type}`);
    const invoiceId = String(row["معرف الفاتورة"] ?? "").trim();
    if (!invoiceId) throw new Error(`معرف فاتورة مفقود في ${job.input}`);
    const group = groups.get(invoiceId) ?? [];
    group.push(row);
    groups.set(invoiceId, group);
  }

  const outputRows = [];
  const verificationRows = [];
  for (const [invoiceId, rows] of groups) {
    const rawTarget = Number(rows[0]["قيمة بند الفاتورة"]);
    if (!Number.isFinite(rawTarget) || rawTarget <= 0) throw new Error(`قيمة غير صالحة للفاتورة ${invoiceId}`);
    const roundedTarget = Math.round(rawTarget);
    const allocations = distributeIntegerEqually(roundedTarget, rows);

    allocations.forEach((amount, index) => {
      if (amount <= 0) return;
      outputRows.push({
        "رقم البطاقة": String(rows[index]["رقم البطاقة"] ?? "").trim(),
        "اسم المستفيد": String(rows[index]["اسم المستفيد"] ?? "").trim(),
        "المبلغ": amount,
        "نوع الخدمة (كشف/أدوية)": job.serviceLabel,
        "ملاحظات (اختياري)": `${invoiceId} — تقريب ${rawTarget} إلى ${roundedTarget}`,
      });
    });

    const distributed = allocations.reduce((sum, amount) => sum + amount, 0);
    verificationRows.push({
      "معرف الفاتورة": invoiceId,
      "القيمة الأصلية": rawTarget,
      "القيمة بعد التقريب": roundedTarget,
      "مجموع التوزيع": distributed,
      "عدد المستفيدين": allocations.filter((amount) => amount > 0).length,
      "الحالة": distributed === roundedTarget ? "صحيح" : "خطأ",
    });
  }

  const outputWorkbook = XLSX.utils.book_new();
  const movementsSheet = XLSX.utils.json_to_sheet(outputRows);
  movementsSheet["!cols"] = [{ wch: 24 }, { wch: 36 }, { wch: 12 }, { wch: 28 }, { wch: 38 }];
  const verificationSheet = XLSX.utils.json_to_sheet(verificationRows);
  verificationSheet["!cols"] = [{ wch: 22 }, { wch: 16 }, { wch: 18 }, { wch: 16 }, { wch: 18 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(outputWorkbook, movementsSheet, "الحركات الجاهزة");
  XLSX.utils.book_append_sheet(outputWorkbook, verificationSheet, "التحقق");
  XLSX.writeFile(outputWorkbook, outputPath);

  return {
    file: job.output,
    invoices: groups.size,
    rows: outputRows.length,
    total: outputRows.reduce((sum, row) => sum + row["المبلغ"], 0),
  };
}

for (const job of jobs) console.log(generate(job));
