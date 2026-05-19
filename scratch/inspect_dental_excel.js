const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const directoryPath = 'c:\\Users\\Omar\\waad_temp_website\\اسماء شركات الاسنان';

function inspectExcel(filename) {
  const filePath = path.join(directoryPath, filename);
  if (!fs.existsSync(filePath)) {
    console.log(`File not found: ${filename}`);
    return;
  }
  
  console.log(`\n========================================`);
  console.log(`Inspecting: ${filename}`);
  try {
    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
    
    if (data.length === 0) {
      console.log(`Sheet is empty`);
      return;
    }
    
    console.log(`Total rows in Excel: ${data.length}`);
    const headers = data[0];
    console.log(`Headers:`, headers);
    
    // Find some sample rows with data
    const samples = [];
    for (let i = 1; i < data.length && samples.length < 5; i++) {
      if (data[i] && data[i].length > 0) {
        samples.push({ rowNum: i + 1, values: data[i] });
      }
    }
    
    console.log(`Sample Rows:`);
    samples.forEach(s => {
      console.log(`  Row ${s.rowNum}:`, s.values);
    });
  } catch (err) {
    console.error(`Error reading file ${filename}:`, err);
  }
}

const files = [
  "OZONE_List.xlsx",
  "Tosyali_List (2).xlsx",
  "Vision_List.xlsx",
  "فيوتشر للموظفين المستوفين البيانات.xlsx",
  "قائمة اسماء شركة رواق.xlsx",
  "قائمة فيوتشر المدمجة.xlsx"
];

files.forEach(inspectExcel);
