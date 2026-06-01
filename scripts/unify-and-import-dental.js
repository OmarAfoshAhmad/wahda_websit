/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const ExcelJS = require("exceljs");
const { PrismaClient, TransactionType } = require("@prisma/client");

const prisma = new PrismaClient();

function parseArgs(argv) {
  const out = {
    apply: false,
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--apply") {
      out.apply = true;
    }
  }
  return out;
}

function buildFacilityUsername(name) {
  const hash = crypto.createHash("sha256").update(name).digest("hex").slice(0, 12);
  return `import_${hash}`;
}

function parseDate(dateValue) {
  if (!dateValue) return new Date("2026-01-01");
  if (dateValue instanceof Date) return dateValue;
  
  const s = String(dateValue).trim();
  if (!s || s === "\u00a0") return new Date("2026-01-01");

  // Format: 25/1/2026 or 25-1-2026
  const matchSlash = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (matchSlash) {
    const day = parseInt(matchSlash[1], 10);
    const month = parseInt(matchSlash[2], 10);
    const year = parseInt(matchSlash[3], 10);
    return new Date(year, month - 1, day);
  }

  // Format ISO: 2026-04-02T00:00:00.000Z
  const parsed = Date.parse(s);
  if (!isNaN(parsed)) {
    return new Date(parsed);
  }

  return new Date("2026-01-01");
}

function matchCompany(card, approvalId, companies) {
  const upperCard = String(card || "").trim().toUpperCase();
  const upperApp = String(approvalId || "").trim().toUpperCase();

  let queryStr = upperCard || upperApp;
  if (!queryStr) return null;

  // Normalize typos
  if (queryStr.startsWith("VINS")) {
    queryStr = queryStr.replace("VINS", "VISN");
  }
  if (queryStr.startsWith("WAD")) {
    queryStr = queryStr.replace("WAD", "WAAD");
  }

  // 1. Match using regex pattern
  for (const company of companies) {
    if (company.card_pattern) {
      try {
        const regex = new RegExp(company.card_pattern);
        if (regex.test(queryStr)) {
          return company;
        }
      } catch (e) {}
    }
  }

  // 2. Fallback starts with code
  for (const company of companies) {
    if (queryStr.startsWith(company.code)) {
      return company;
    }
  }

  // 3. Fallback for approval ID prefix
  if (upperApp) {
    let appPrefix = upperApp;
    if (appPrefix.startsWith("VINS")) appPrefix = appPrefix.replace("VINS", "VISN");
    if (appPrefix.startsWith("WAD")) appPrefix = appPrefix.replace("WAD", "WAAD");

    for (const company of companies) {
      if (appPrefix.startsWith(company.code)) {
        return company;
      }
    }
  }

  return null;
}

function resolveFacility(name, facilityMapping, dbFacilities) {
  const clean = String(name || "").trim();
  if (!clean) return null;

  const mapped = facilityMapping.get(clean.toLowerCase());
  if (mapped) {
    return { id: mapped.systemId, name: mapped.systemName };
  }

  const exact = dbFacilities.find(f => f.name.trim().toLowerCase() === clean.toLowerCase());
  if (exact) {
    return { id: exact.id, name: exact.name };
  }

  const cleanLower = clean.replace(/\s+/g, "").toLowerCase();
  const loose = dbFacilities.find(f => {
    const cleanDb = f.name.replace(/\s+/g, "").toLowerCase();
    return cleanDb.includes(cleanLower) || cleanLower.includes(cleanDb);
  });
  if (loose) {
    return { id: loose.id, name: loose.name };
  }

  return null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const apply = args.apply;

  console.log(`🚀 Start Processing: Unify Facilities & Split Deductions by Company`);
  console.log(`Mode: ${apply ? "🔴 APPLY CHANGES TO DB" : "🔵 DRY RUN (Simulation)"}`);

  // 1. Load active companies from the database
  const companies = await prisma.insuranceCompany.findMany({
    where: { deleted_at: null }
  });
  console.log(`Loaded ${companies.length} companies from the database.`);

  // 2. Ensure JFZ company exists
  let jfzCompany = companies.find(c => c.code === "JFZ");
  if (!jfzCompany) {
    console.log("Creating missing company: المنطقة الحرة (JFZ)");
    if (apply) {
      jfzCompany = await prisma.insuranceCompany.create({
        data: {
          name: "المنطقة الحرة (JFZ)",
          code: "JFZ",
          card_pattern: "^JFZ2025.*",
          is_active: true,
          dental_ceiling: 3000.00,
          dental_coverage: 100.00,
          general_ceiling: null,
          general_coverage: 80.00,
          medicine_ceiling: null,
          medicine_coverage: 80.00,
        }
      });
      console.log(`Created company JFZ with ID: ${jfzCompany.id}`);
    } else {
      jfzCompany = { id: "temp_jfz_id", name: "المنطقة الحرة (JFZ)", code: "JFZ", card_pattern: "^JFZ2025.*" };
      console.log(`[DRY RUN] Will create company JFZ and DENTAL policy with ceiling 3000.00`);
    }
    companies.push(jfzCompany);
  }

  // 3. Load facility mapping from Excel
  const facilityMapping = new Map();
  
  // Register manual spelling mapping fallbacks
  facilityMapping.set("الليبيه التخصيصيه", { systemName: "الليبية التخصصية - اسنان", systemId: "cmn78k17t0034nz1nkwiklngp" });
  facilityMapping.set("الليبيه التخصصيه", { systemName: "الليبية التخصصية - اسنان", systemId: "cmn78k17t0034nz1nkwiklngp" });
  facilityMapping.set("الليبية التخصصيه", { systemName: "الليبية التخصصية - اسنان", systemId: "cmn78k17t0034nz1nkwiklngp" });
  facilityMapping.set("فينسيا", { systemName: "مركز فينيسيا - اسنان", systemId: "cmn78k17t0035nz1n3t9j6iey" });

  const wbMap = new ExcelJS.Workbook();
  const mapPath = fs.existsSync("خصومات الاسنان - مطابقة المرافق.xlsx")
    ? "خصومات الاسنان - مطابقة المرافق.xlsx"
    : "c:/Users/Omar/waad_temp_website/خصومات الاسنان - مطابقة المرافق.xlsx";
  if (!fs.existsSync(mapPath)) {
    throw new Error(`Mapping file not found at ${mapPath}`);
  }
  await wbMap.xlsx.readFile(mapPath);
  const wsMap = wbMap.worksheets[0];
  for (let i = 2; i <= wsMap.rowCount; i++) {
    const row = wsMap.getRow(i);
    const excelName = String(row.getCell(1).value ?? "").trim();
    const systemName = String(row.getCell(2).value ?? "").trim();
    const systemId = String(row.getCell(4).value ?? "").trim();
    if (excelName && systemId) {
      facilityMapping.set(excelName.toLowerCase(), { systemName, systemId });
    }
  }
  console.log(`Loaded ${facilityMapping.size} facility mapping rules.`);

  // 4. Load database facilities
  const dbFacilities = await prisma.facility.findMany({
    where: { deleted_at: null }
  });
  console.log(`Loaded ${dbFacilities.length} system facilities.`);

  // 5. Read the main dental deductions Excel
  const sourcePath = fs.existsSync("خصومات الاسنان - Copy.xlsx")
    ? "خصومات الاسنان - Copy.xlsx"
    : "c:/Users/Omar/waad_temp_website/خصومات الاسنان - Copy.xlsx";
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Deductions file not found at ${sourcePath}`);
  }
  const wbSrc = new ExcelJS.Workbook();
  await wbSrc.xlsx.readFile(sourcePath);
  const wsSrc = wbSrc.worksheets[0];
  console.log(`Reading source workbook, rows count: ${wsSrc.rowCount}`);

  let activeLayout = null;
  const companyRows = {};
  let totalProcessedRows = 0;
  let skippedRows = 0;

  for (let i = 1; i <= wsSrc.rowCount; i++) {
    const row = wsSrc.getRow(i);
    const firstCell = String(row.getCell(1).value ?? "").trim();

    if (firstCell.includes("اسم المريض") || firstCell.includes("الاسم") || firstCell.includes("اسم المريض ")) {
      // Dynamic header layout parsing
      activeLayout = {};
      row.eachCell({ includeEmpty: true }, (cell, colNum) => {
        const val = String(cell.value ?? "").trim();
        if (!val) return;
        if (val.includes("مريض") || val === "الاسم") {
          activeLayout["PATIENT_NAME"] = colNum;
        } else if (val.includes("تأمين") || val.includes("تامين")) {
          activeLayout["CARD_NUMBER"] = colNum;
        } else if (val.includes("موافقة") || val.includes("موافقه")) {
          activeLayout["APPROVAL_ID"] = colNum;
        } else if (val.includes("تاريخ")) {
          activeLayout["DATE"] = colNum;
        } else if (val.includes("قيمة") || val.includes("مالية") || val.includes("قيمه")) {
          activeLayout["AMOUNT"] = colNum;
        } else if (val.includes("مرفق") || val.includes("جهة") || val.includes("جيهة")) {
          activeLayout["FACILITY"] = colNum;
        } else if (val.includes("ملاحظات") || val.includes("ملاحظه") || val.includes("ملاحظات ")) {
          activeLayout["NOTES"] = colNum;
        }
      });
      continue;
    }

    if (!activeLayout) continue;

    const patientName = activeLayout["PATIENT_NAME"] ? String(row.getCell(activeLayout["PATIENT_NAME"]).value ?? "").trim() : "";
    let cardNumber = activeLayout["CARD_NUMBER"] ? String(row.getCell(activeLayout["CARD_NUMBER"]).value ?? "").trim().toUpperCase() : "";
    const approvalId = activeLayout["APPROVAL_ID"] ? String(row.getCell(activeLayout["APPROVAL_ID"]).value ?? "").trim().toUpperCase() : "";
    const dateVal = activeLayout["DATE"] ? row.getCell(activeLayout["DATE"]).value : null;
    const amountVal = activeLayout["AMOUNT"] ? row.getCell(activeLayout["AMOUNT"]).value : null;
    const facilityName = activeLayout["FACILITY"] ? String(row.getCell(activeLayout["FACILITY"]).value ?? "").trim() : "";
    const notes = activeLayout["NOTES"] ? String(row.getCell(activeLayout["NOTES"]).value ?? "").trim() : "";

    // Skip headers or summary rows
    if (!patientName && !cardNumber && !approvalId) {
      skippedRows++;
      continue;
    }
    if (patientName.includes("جدول") || patientName.includes("سقف") || cardNumber.includes("سقف")) {
      skippedRows++;
      continue;
    }

    // Resolve facility
    let resolvedFac = resolveFacility(facilityName, facilityMapping, dbFacilities);
    if (!resolvedFac) {
      if (facilityName && facilityName !== " ") {
        console.log(`ℹ️ Info: Facility "${facilityName}" was not found. Will create it dynamically.`);
        resolvedFac = { id: `temp_fac_${facilityName}`, name: facilityName };
      } else {
        skippedRows++;
        continue;
      }
    }

    // Correct card number typos
    if (cardNumber.startsWith("VINS")) {
      cardNumber = cardNumber.replace("VINS", "VISN");
    }
    if (cardNumber.startsWith("WAD")) {
      cardNumber = cardNumber.replace("WAD", "WAAD");
    }

    // Match company
    const matchedComp = matchCompany(cardNumber, approvalId, companies);
    if (!matchedComp) {
      console.warn(`⚠️ Warning: Could not match company for card "${cardNumber}" / approval "${approvalId}" in row ${i}. Skipping row.`);
      skippedRows++;
      continue;
    }

    // Parse amount
    let amount = 0;
    if (typeof amountVal === "number") {
      amount = amountVal;
    } else {
      amount = parseFloat(String(amountVal ?? "0").replace(/,/g, "")) || 0;
    }

    const parsedDate = parseDate(dateVal);

    if (!companyRows[matchedComp.code]) {
      companyRows[matchedComp.code] = [];
    }

    companyRows[matchedComp.code].push({
      rowNum: i,
      patientName,
      cardNumber,
      approvalId,
      amount,
      date: parsedDate,
      facilityId: resolvedFac.id,
      facilityName: resolvedFac.name, // unified/original facility name
      notes
    });

    totalProcessedRows++;
  }

  console.log(`Processed ${totalProcessedRows} transaction rows (Skipped/Ignored ${skippedRows} rows).`);

  // 6. Generate separate Excel files for each company
  const outputDir = "c:/Users/Omar/waad_temp_website/حركات الشركات للأسنان";
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  for (const [code, rows] of Object.entries(companyRows)) {
    const wbComp = new ExcelJS.Workbook();
    const wsComp = wbComp.addWorksheet("الاسنان");

    // Header Row matching system standard layout
    wsComp.addRow([
      "اسم المريض",
      "رقم التأمين ",
      "رقم الموافقة ",
      "القيمة المالية",
      "التاريخ",
      "ملاحظات",
      "المرفق الصحي"
    ]);

    for (const r of rows) {
      const formattedDate = r.date.toISOString().slice(0, 10);
      wsComp.addRow([
        r.patientName,
        r.cardNumber,
        r.approvalId,
        r.amount,
        formattedDate,
        r.notes,
        r.facilityName
      ]);
    }

    // Styling
    const headerRow = wsComp.getRow(1);
    headerRow.height = 28;
    for (let c = 1; c <= 7; c++) {
      const cell = headerRow.getCell(c);
      cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF4F46E5' } // Royal indigo theme for company files
      };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
    }

    wsComp.columns.forEach(column => {
      let maxLen = 0;
      column.eachCell({ includeEmpty: true }, (cell) => {
        const len = cell.value ? String(cell.value).length : 0;
        if (len > maxLen) maxLen = len;
      });
      column.width = Math.max(maxLen + 4, 18);
    });

    const filePath = path.join(outputDir, `${code}_Transactions.xlsx`);
    await wbComp.xlsx.writeFile(filePath);
    console.log(`✅ File generated: "${code}_Transactions.xlsx" with ${rows.length} rows at ${filePath}`);
  }

  // 7. Perform Database Import (if --apply is specified)
  if (!apply) {
    console.log("🏁 Dry run finished successfully. Run again with --apply to write to the database.");
    await prisma.$disconnect();
    return;
  }

  console.log("📥 Starting Database Import process...");

  const allDbBeneficiaries = await prisma.beneficiary.findMany({
    select: { id: true, card_number: true, remaining_balance: true, total_balance: true, completed_via: true, deleted_at: true }
  });

  const beneficiaryMap = new Map();
  for (const b of allDbBeneficiaries) {
    const key = String(b.card_number || "").trim().toUpperCase();
    beneficiaryMap.set(key, b);
  }

  const defaultPasswordHash = await bcrypt.hash("ImportOnly-ChangeMe-2026", 10);

  for (const [code, rows] of Object.entries(companyRows)) {
    const company = companies.find(c => c.code === code);
    if (!company) continue;

    const dentalCeiling = company.dental_ceiling ? Number(company.dental_ceiling) : 3000.00;
    console.log(`Company "${company.name}" (${code}): Using DENTAL ceiling = ${dentalCeiling}`);

    // Group rows by card number to process beneficiary creation / balance update
    const rowsByCard = {};
    for (const r of rows) {
      if (!rowsByCard[r.cardNumber]) {
        rowsByCard[r.cardNumber] = [];
      }
      rowsByCard[r.cardNumber].push(r);
    }

    let createdBeneficiaries = 0;
    let updatedBeneficiaries = 0;
    let createdTransactions = 0;
    let skippedTransactions = 0;

    for (const [card, cardRows] of Object.entries(rowsByCard)) {
      // Find or create beneficiary in memory map
      const cardKey = String(card || "").trim().toUpperCase();
      let beneficiary = beneficiaryMap.get(cardKey);

      let totalCardDeduction = cardRows.reduce((sum, r) => sum + r.amount, 0);

      if (!beneficiary) {
        // Create beneficiary
        const patientName = cardRows[0].patientName;
        const remaining = Math.max(0, dentalCeiling - totalCardDeduction);
        
        console.log(`Creating beneficiary: card = "${card}", name = "${patientName}"`);
        beneficiary = await prisma.beneficiary.create({
          data: {
            card_number: card,
            name: patientName,
            company_id: company.id,
            total_balance: dentalCeiling,
            remaining_balance: remaining,
            status: remaining <= 0 ? "FINISHED" : "ACTIVE",
            completed_via: remaining <= 0 ? "IMPORT" : null
          }
        });
        beneficiaryMap.set(cardKey, beneficiary);
        createdBeneficiaries++;

        // Initialize WalletConsumption
        await prisma.walletConsumption.create({
          data: {
            beneficiary_id: beneficiary.id,
            company_id: company.id,
            wallet_type: "DENTAL",
            fiscal_year: 2026,
            consumed_amount: totalCardDeduction,
            version: 1
          }
        });
      } else {
        // Beneficiary exists: if it was soft-deleted, restore it first!
        if (beneficiary.deleted_at !== null) {
          console.log(`Restoring soft-deleted beneficiary: card = "${card}", name = "${beneficiary.name}"`);
          await prisma.beneficiary.update({
            where: { id: beneficiary.id },
            data: { deleted_at: null }
          });
          beneficiary.deleted_at = null;
        }

        // update remaining_balance and WalletConsumption
        const currentRemaining = Number(beneficiary.remaining_balance);
        const newRemaining = Math.max(0, currentRemaining - totalCardDeduction);

        await prisma.beneficiary.update({
          where: { id: beneficiary.id },
          data: {
            remaining_balance: newRemaining,
            status: newRemaining <= 0 ? "FINISHED" : "ACTIVE",
            completed_via: newRemaining <= 0 ? "IMPORT" : beneficiary.completed_via
          }
        });
        
        // Update in-memory mapping cache
        beneficiary.remaining_balance = newRemaining;
        if (newRemaining <= 0) {
          beneficiary.completed_via = "IMPORT";
        }
        updatedBeneficiaries++;

        // Update WalletConsumption
        const wallet = await prisma.walletConsumption.findUnique({
          where: {
            beneficiary_id_company_id_wallet_type_fiscal_year: {
              beneficiary_id: beneficiary.id,
              company_id: company.id,
              wallet_type: "DENTAL",
              fiscal_year: 2026
            }
          }
        });

        if (wallet) {
          await prisma.walletConsumption.update({
            where: { id: wallet.id },
            data: {
              consumed_amount: Number(wallet.consumed_amount) + totalCardDeduction,
              version: { increment: 1 }
            }
          });
        } else {
          await prisma.walletConsumption.create({
            data: {
              beneficiary_id: beneficiary.id,
              company_id: company.id,
              wallet_type: "DENTAL",
              fiscal_year: 2026,
              consumed_amount: totalCardDeduction,
              version: 1
            }
          });
        }
      }

      // Create transactions
      for (const r of cardRows) {
        let facId = r.facilityId;
        
        // Dynamically create missing facility
        if (facId.startsWith("temp_fac_")) {
          let dbFac = await prisma.facility.findFirst({ where: { name: r.facilityName } });
          if (!dbFac) {
            const username = buildFacilityUsername(r.facilityName);
            dbFac = await prisma.facility.create({
              data: {
                name: r.facilityName,
                username,
                password_hash: defaultPasswordHash,
                is_admin: false,
                is_manager: false,
                must_change_password: true
              }
            });
            console.log(`✅ Created missing facility: "${r.facilityName}" with ID: ${dbFac.id}`);
          }
          facId = dbFac.id;
        }

        // Use approval ID if unique, or fallback to composite ID to prevent duplication
        const txId = r.approvalId ? `${code}_${r.approvalId}` : `TX_${beneficiary.id}_${r.amount}_${r.date.getTime()}`;

        const existingTx = await prisma.transaction.findUnique({
          where: { id: txId }
        });

        if (existingTx) {
          skippedTransactions++;
          continue;
        }

        await prisma.transaction.create({
          data: {
            id: txId,
            beneficiary_id: beneficiary.id,
            facility_id: facId,
            company_id: company.id,
            amount: r.amount,
            type: r.amount < 0 ? TransactionType.CANCELLATION : TransactionType.DENTAL,
            service_category: "DENTAL",
            ceiling_consumed: r.amount,
            original_company_share: r.amount,
            original_patient_share: 0,
            actual_company_share: r.amount,
            actual_patient_share: 0,
            created_at: r.date,
            is_cancelled: r.amount < 0,
            calc_metadata: { imported: true, script: "unify-and-import-dental.js" }
          }
        });
        createdTransactions++;
      }
    }

    console.log(`[${code}] Imported stats:`);
    console.log(` - Beneficiaries Created: ${createdBeneficiaries}`);
    console.log(` - Beneficiaries Updated: ${updatedBeneficiaries}`);
    console.log(` - Transactions Inserted: ${createdTransactions}`);
    console.log(` - Duplicate Transactions Skipped: ${skippedTransactions}`);
  }

  console.log("🏁 Database Import process finished successfully!");
  await prisma.$disconnect();
}

main().catch(err => {
  console.error("❌ Fatal Error in main process:", err);
  prisma.$disconnect();
  process.exit(1);
});
