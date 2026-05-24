const { PrismaClient } = require("@prisma/client");
const ExcelJS = require("exceljs");
const path = require("path");
const fs = require("fs");

const prisma = new PrismaClient();

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

async function testFile(fileName) {
  console.log(`\n=== Checking unmatched facilities in ${fileName} ===`);
  const filePath = path.join(__dirname, "..", "حركات الشركات للأسنان", fileName);
  if (!fs.existsSync(filePath)) {
    console.log(`File not found: ${filePath}`);
    return;
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const ws = workbook.getWorksheet(1) || workbook.worksheets[0];

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

  const unmatched = new Set();
  const rowCount = ws.rowCount;

  for (let i = 2; i <= rowCount; i++) {
    const row = ws.getRow(i);
    const facilityVal = row.getCell(7).value;
    const facilityName = facilityVal ? String(facilityVal).trim() : "";
    if (facilityName && !resolveFacility(facilityName)) {
      unmatched.add(facilityName);
    }
  }

  console.log(`Unmatched facilities found (${unmatched.size}):`);
  console.log(Array.from(unmatched));
}

async function run() {
  await testFile("JMR_Transactions.xlsx");
  await testFile("LCC_Transactions.xlsx");
}

run()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
