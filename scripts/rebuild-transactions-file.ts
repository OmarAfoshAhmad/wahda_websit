import ExcelJS from "exceljs";

async function main() {
  console.log("🚀 جاري تحميل ملف المطابقة...");
  const mappingWb = new ExcelJS.Workbook();
  await mappingWb.xlsx.readFile("c:\\Users\\Omar\\waad_temp_website\\المرافق_المطابقة_النهائي.xlsx");
  const mapWs = mappingWb.worksheets[0];

  // Build the mapping dictionary
  const facilityMap = new Map<string, string>();
  mapWs.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // skip header
    const original = String(row.getCell(1).value || "").trim();
    const matched = String(row.getCell(2).value || "").trim();
    if (original && matched && matched !== "--- لم يتم العثور عليه ---") {
      facilityMap.set(original, matched);
    }
  });

  console.log(`✅ تم تحميل ${facilityMap.size} مرفق مطابق للاستبدال.`);

  console.log("🚀 جاري معالجة ملف الحركات الأصلي...");
  const txWb = new ExcelJS.Workbook();
  await txWb.xlsx.readFile("c:\\Users\\Omar\\waad_temp_website\\حركات نظارات قبل الاطلاق.xlsx");

  let modifiedCount = 0;

  txWb.worksheets.forEach(ws => {
    // Find which column is "الجيهة "
    let headerRow = 2;
    let facilityCol = -1;
    
    const rowVals = ws.getRow(headerRow).values as any[];
    if (rowVals && rowVals.length > 0) {
      for (let i = 1; i < rowVals.length; i++) {
        const val = String(rowVals[i] || "").trim();
        if (val.includes("الجيهة") || val.includes("الجهة") || val.includes("المرفق")) {
          facilityCol = i;
          break;
        }
      }
    }

    if (facilityCol === -1) {
      console.log(`⚠️ لم يتم العثور على عمود المرفق في ورقة: ${ws.name}`);
      return;
    }

    console.log(`🔍 جاري فحص وتوحيد المرافق في ورقة: ${ws.name} (عمود ${facilityCol})`);

    ws.eachRow((row, rowNumber) => {
      if (rowNumber <= headerRow) return;
      const originalVal = String(row.getCell(facilityCol).value || "").trim();
      
      if (originalVal) {
        const mappedName = facilityMap.get(originalVal);
        if (mappedName && mappedName !== originalVal) {
          row.getCell(facilityCol).value = mappedName;
          modifiedCount++;
        }
      }
    });
  });

  const outputPath = "c:\\Users\\Omar\\waad_temp_website\\حركات_مستفيدين_موحدة_ونظيفة.xlsx";
  await txWb.xlsx.writeFile(outputPath);
  
  console.log(`✅ تمت العملية بنجاح!`);
  console.log(`🔄 إجمالي المرافق التي تم توحيدها وتعديل أسمائها: ${modifiedCount}`);
  console.log(`📂 مسار الملف الجديد: ${outputPath}`);
}

main().catch(console.error);
