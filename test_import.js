const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const xlsx = require('xlsx');

function loadExcel() {
  const path = 'c:\\Users\\Omar\\waad_temp_website\\الاسماء_دقيقة.xlsx';
  const buf = fs.readFileSync(path);
  const wb = xlsx.read(buf, { type: 'buffer' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const data = xlsx.utils.sheet_to_json(ws);
  return data.map(r => ({
    name: r['الاسم'],
    employee_number: String(r['رقم الوظيفي'] || ''),
    relationship: r['المستفيد'],
    birth_date: r['تاريخ الميلاد'] ? String(r['تاريخ الميلاد']) : undefined,
    field3: r['ملاحظات']
  }));
}

const fs = require('fs');

async function testImport() {
  // Mock getSession and others
  const data = loadExcel();
  
  // Minimal copy of the logic that fails
  // Since we just want to see the error, we'll try to insert them into DB and see what Prisma throws.
  
  // We can just require the action and run it!
  // Wait, action requires getSession. Let's mock it inside Next.js by calling it via a small script that loads Next environment?
  // Easier: let's just make a dummy Next.js endpoint or mock `getSession`.
}
testImport();
