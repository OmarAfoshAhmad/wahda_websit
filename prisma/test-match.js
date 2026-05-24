const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const ExcelJS = require("exceljs");
const path = require("path");

const FACILITY_MAP = {
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

function normalizeCardNumber(card) {
  if (!card) return "";
  return String(card).trim().toUpperCase();
}

function parseExcelDate(val) {
  if (!val) return new Date();
  if (val instanceof Date && !isNaN(val.getTime())) return val;
  if (typeof val === "object") {
    if (val.result instanceof Date && !isNaN(val.result.getTime())) return val.result;
    if (val.result !== undefined && val.result !== null) val = val.result;
    else if (val.text !== undefined && val.text !== null) val = val.text;
    else if (val.value !== undefined && val.value !== null) val = val.value;
  }
  if (typeof val === "number" && !isNaN(val)) {
    const date = new Date((val - 25569) * 86400 * 1000);
    if (!isNaN(date.getTime())) return date;
  }
  if (typeof val === "string") {
    const cleaned = val.trim();
    if (!cleaned) return new Date();
    const slashMatch = cleaned.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (slashMatch) {
      const day = parseInt(slashMatch[1], 10);
      const month = parseInt(slashMatch[2], 10) - 1;
      const year = parseInt(slashMatch[3], 10);
      const d = new Date(year, month, day);
      if (!isNaN(d.getTime())) return d;
    }
    const isoMatch = cleaned.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
    if (isoMatch) {
      const year = parseInt(isoMatch[1], 10);
      const month = parseInt(isoMatch[2], 10) - 1;
      const day = parseInt(isoMatch[3], 10);
      const d = new Date(year, month, day);
      if (!isNaN(d.getTime())) return d;
    }
    const parsed = new Date(cleaned);
    if (!isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
}

async function testFile(fileName, companyId) {
  const filePath = path.join(__dirname, "..", "حركات الشركات للأسنان", fileName);
  console.log(`\n=======================================\nTesting File: ${fileName}\nCompany ID: ${companyId}`);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const ws = workbook.getWorksheet(1) || workbook.worksheets[0];

  const rawRows = [];
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
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

  const uniqueCards = Array.from(new Set(rawRows.map(r => r.card).filter(Boolean)));

  const dbBeneficiaries = await prisma.beneficiary.findMany({
    where: {
      deleted_at: null,
      company_id: companyId
    },
    select: {
      id: true,
      card_number: true,
      name: true,
      company_id: true,
      company: {
        select: {
          id: true,
          name: true
        }
      }
    }
  });

  console.log(`Fetched ${dbBeneficiaries.length} beneficiaries from DB for company ${companyId}`);

  const resolveBeneficiary = (excelCard, excelName) => {
    if (!excelCard) return null;
    const normExcelCard = excelCard.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    const cleanExcelName = excelName.trim().replace(/\s+/g, " ");

    const nameMatch = (dbName, exName) => {
      const cleanDb = dbName.trim().replace(/\s+/g, " ");
      if (cleanDb === exName) return 1.0;
      if (cleanDb.includes(exName) || exName.includes(cleanDb)) return 0.8;
      const dbWords = cleanDb.split(" ").filter(Boolean);
      const exWords = exName.split(" ").filter(Boolean);
      const intersection = dbWords.filter(w => exWords.includes(w));
      if (intersection.length >= 2) return 0.6;
      return 0.0;
    };

    const exactMatch = dbBeneficiaries.find(b => 
      b.card_number.trim().toUpperCase().replace(/[^A-Z0-9]/g, "") === normExcelCard
    );
    if (exactMatch) return exactMatch;

    const getBase = (c) => c.replace(/[MFWSD]?\d+$/, "").replace(/[MFWSD]$/, "");
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
      if (bestCandidate && highestScore > 0) return bestCandidate;
      return baseCandidates[0];
    }

    const nameCandidates = dbBeneficiaries.filter(b => nameMatch(b.name, cleanExcelName) >= 0.8);
    if (nameCandidates.length === 1) return nameCandidates[0];

    return null;
  };

  const dbFacilities = await prisma.facility.findMany({
    where: { deleted_at: null },
    select: { id: true, name: true }
  });

  const resolveFacility = (name) => {
    if (!name) return null;
    const clean = name.trim();
    const mappedId = FACILITY_MAP[clean];
    if (mappedId) {
      const found = dbFacilities.find(f => f.id === mappedId);
      if (found) return found;
    }
    const exact = dbFacilities.find(f => f.name === clean);
    if (exact) return exact;
    const cleanLower = clean.replace(/\s+/g, "").toLowerCase();
    const loose = dbFacilities.find(f => {
      const cleanDb = f.name.replace(/\s+/g, "").toLowerCase();
      return cleanDb.includes(cleanLower) || cleanLower.includes(cleanDb);
    });
    return loose || null;
  };

  let insertedCount = 0;
  let skippedCount = 0;
  const skippedDetails = [];

  for (const r of rawRows) {
    const facility = resolveFacility(r.facilityName);
    const beneficiary = r.card ? resolveBeneficiary(r.card, r.name) : null;

    if (!r.card) {
      skippedCount++;
      skippedDetails.push({ rowNumber: r.rowNumber, name: r.name, card: "", reason: "Insurance number is empty" });
      continue;
    }

    if (!beneficiary) {
      // Find if this card is in DB under another company
      const otherBen = await prisma.beneficiary.findFirst({
        where: {
          card_number: { mode: "insensitive", equals: r.card },
          deleted_at: null
        },
        include: { company: true }
      });

      skippedCount++;
      skippedDetails.push({
        rowNumber: r.rowNumber,
        name: r.name,
        card: r.card,
        facilityName: r.facilityName,
        reason: otherBen 
          ? `Beneficiary belongs to another company (${otherBen.company?.name})` 
          : "Beneficiary not found in DB under this company"
      });
      continue;
    }

    if (!facility) {
      skippedCount++;
      skippedDetails.push({ rowNumber: r.rowNumber, name: r.name, card: r.card, facilityName: r.facilityName, reason: "Facility not found/matched" });
      continue;
    }

    insertedCount++;
  }

  console.log(`Summary: Total rows = ${rawRows.length}, Matched/Inserted = ${insertedCount}, Skipped/Error = ${skippedCount}`);
  if (skippedDetails.length > 0) {
    console.log("Samples of skipped rows (first 10):");
    console.log(JSON.stringify(skippedDetails.slice(0, 10), null, 2));
  }
}

async function run() {
  // Customs (JMR): cmpgpi50z000uu9h4fh82k1ha
  await testFile("JMR_Transactions.xlsx", "cmpgpi50z000uu9h4fh82k1ha");

  // Cement (LCC): cmpgpi516000xu9h4b2zpk92x
  await testFile("LCC_Transactions.xlsx", "cmpgpi516000xu9h4b2zpk92x");
}

run()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
