import ExcelJS from "exceljs";
import { PrismaClient } from "@prisma/client";
import { createImportJob, processImportJob } from "../src/lib/import-jobs";

const prisma = new PrismaClient();

async function main() {
  const companyCode = "JMR";
  const filePath = "c:/Users/Omar/waad_temp_website/اسماء شركات الاسنان جاهزة للاستيراد/Jamarek_List_Import.xlsx";
  const username = "admin";

  // 1. Fetch Company
  const company = await prisma.insuranceCompany.findFirst({
    where: { code: companyCode }
  });
  if (!company) {
    throw new Error(`Company with code ${companyCode} not found!`);
  }
  console.log(`Matched company: ${company.name} (ID: ${company.id})`);

  // 2. Load Workbook
  console.log(`Loading Excel file: ${filePath}...`);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    throw new Error("No worksheet found!");
  }

  // 3. Parse headers and rows (identical to route.ts)
  const headerRow = worksheet.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    while (headers.length < colNumber - 1) headers.push("");
    headers.push(String(cell.value ?? "").trim());
  });

  console.log("Parsed headers:", headers);

  const rows: Record<string, unknown>[] = [];
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // Skip headers
    const obj: Record<string, unknown> = { __rowNumber: rowNumber };
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const header = headers[colNumber - 1];
      if (header) {
        const v = cell.value;
        obj[header] = v instanceof Date ? v.toISOString() : v;
      }
    });
    if (Object.values(obj).some((v) => v !== null && v !== undefined && v !== "")) {
      rows.push(obj);
    }
  });

  console.log(`Extracted ${rows.length} rows from Excel file.`);

  // 4. Create Import Job
  const options = {
    updateBalance: false,
    reactivate: false,
    company_id: company.id
  };

  console.log("Creating import job in DB...");
  const jobResult = await createImportJob(rows, username, options);
  if (jobResult.error) {
    throw new Error(`Failed to create import job: ${jobResult.error}`);
  }
  const job = jobResult.job!;
  console.log(`Created Job ID: ${job.id} with status: ${job.status}`);

  // 5. Run Import Job
  console.log(`Running processImportJob for ${job.id}...`);
  const runResult = await processImportJob(job.id, username);
  console.log("Finished running import job!");
  console.log(JSON.stringify(runResult, null, 2));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
