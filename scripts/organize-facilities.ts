import { PrismaClient } from "@prisma/client";
import ExcelJS from "exceljs";
import path from "path";

const prisma = new PrismaClient();

const FACILITY_MAP: Record<string, string> = {
  // الجهمي
  "الجهمي للبصريات": "waljahmi_eye",
  "شركه مجموعة الجهمي": "waljahmi_eye",
  "مجموعة الجهمي": "waljahmi_eye",
  "مجموعة الجهمي للبصريات": "waljahmi_eye",
  "شركه مجموعه الجهمي": "waljahmi_eye",
  "مجموعة الجهمي للبصرياات": "waljahmi_eye",
  "مجموعة  الجهمي": "waljahmi_eye",
  
  // ساطي
  "ساطي": "wsati_eye",
  "ساطي للبصريات": "wsati_eye",
  "شركة ساطي": "wsati_eye",
  "الساطي": "wsati_eye",
  "شركة الساطي": "wsati_eye",

  // دلتا
  "دلتا للبصريات": "wdelta_eye",
  "دلتا البصريات": "wdelta_eye",
  "دلتا": "wdelta_eye",

  // 21 بصريات
  "21 للبصريات": "wtwenty_one_eye",
  "21بصريات": "wtwenty_one_eye",
  "21 بصريات": "wtwenty_one_eye",

  // برنيق
  "البرنيق": "wberniq_eye",
  "البرنيق للبصريات": "wberniq_eye",
  "شركة برنيق الجديد": "wberniq_eye",
  "برنيق الجديد": "wberniq_eye",

  // الرؤية
  "الرؤية للبصريات": "wroaya_eye",
  "رؤية للبصريات": "wroaya_eye",
  "رؤيه": "wroaya_eye",
  "رؤية": "wroaya_eye",

  // الأنيس
  "الانيس للبصريات": "walanis_eye",
  "الانيس": "walanis_eye",

  // الأمل للشفاء
  "الامل للشفاء": "walamal_eye",

  // ليتوريا
  "ليتوريا": "wletoria_eye",
  "مركز ليتوريا": "wletoria_eye",

  // مكين
  "مكين": "wmakeen_eye",

  // رشاد
  "الرشاد": "wrashad_eye",
  "رشاد للبصريات": "wrashad_eye",
  "مركز رشاد": "wrashad_eye",

  // المتقدم
  "المتقدم": "wmotakadem_eye",
  "المتقدم للبصريات": "wmotakadem_eye",

  // ابن سينا
  "ابن سينا  للبصريات": "wibnsina_eye",

  // بوراوي
  "بوراوي للبصريات": "wborawi_eye",

  // بصريات الشريف
  "بصريات الشريف": "walshareef_eye",

  // أبو النجا
  "ابو النجا": "wabonaja_eye",

  // الوصال
  "الوصال للبصريات": "walwesal_eye",
  "الوصال": "walwesal_eye",

  // مركز درنة
  "مركز درنة الطبي": "wderna_eye",
  "مركز درتة": "wderna_eye",

  // مركز الحكيم
  "مركز الحكيم": "walhakim_eye",

  // الأميرة
  "الأميرة للنظارات": "walamira_eye"
};

async function main() {
  const dbFacilities = await prisma.facility.findMany({
    where: { deleted_at: null },
    select: { id: true, name: true, username: true },
  });

  const extractFacilities = async (filePath: string) => {
    const facilities = new Set<string>();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(filePath);
    wb.worksheets.forEach(ws => {
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
        console.log(`Column for Facility not found in sheet ${ws.name}`);
        return;
      }

      ws.eachRow((row, rowNumber) => {
        if (rowNumber <= headerRow) return;
        const val = row.getCell(facilityCol).value;
        if (val) {
          facilities.add(String(val).trim());
        }
      });
    });
    return Array.from(facilities);
  };

  // Extract only from حركات نظارات قبل الاطلاق.xlsx
  const allUniqueFacilities = await extractFacilities("c:\\Users\\Omar\\waad_temp_website\\حركات نظارات قبل الاطلاق.xlsx");
  console.log(`Found ${allUniqueFacilities.length} unique facility names in the Excel file.`);

  const resolveFacility = (name: string) => {
    const clean = name.trim();
    const mappedUsername = FACILITY_MAP[clean];
    if (mappedUsername) {
      const found = dbFacilities.find(f => f.username === mappedUsername);
      if (found) return { match: found, method: "Custom Map" };
    }

    const exact = dbFacilities.find(f => f.name === clean);
    if (exact) return { match: exact, method: "Exact Name" };

    const cleanLower = clean.replace(/\s+/g, "").toLowerCase();
    const loose = dbFacilities.find(f => {
      const cleanDb = f.name.replace(/\s+/g, "").toLowerCase();
      return cleanDb.includes(cleanLower) || cleanLower.includes(cleanDb);
    });
    if (loose) return { match: loose, method: "Loose Name Match" };

    return { match: null, method: "Not Found" };
  };

  const results = allUniqueFacilities.map(f => {
    const { match, method } = resolveFacility(f);
    return {
      original: f,
      matchedName: match ? match.name : "--- لم يتم العثور عليه ---",
      matchedUsername: match ? match.username : "",
      method
    };
  });

  // Generate new Excel
  const newWb = new ExcelJS.Workbook();
  const ws = newWb.addWorksheet("مطابقة المراكز");
  
  ws.columns = [
    { header: "الاسم في الملف", key: "original", width: 30 },
    { header: "الاسم في المنظومة", key: "matchedName", width: 30 },
    { header: "اليوزر بالمنظومة", key: "matchedUsername", width: 25 },
    { header: "حالة التطابق", key: "method", width: 20 },
  ];

  results.forEach(r => {
    const row = ws.addRow(r);
    if (r.method === "Not Found") {
      row.getCell("matchedName").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFF0000" } };
    } else {
      row.getCell("matchedName").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF00FF00" } };
    }
  });

  const outputPath = "c:\\Users\\Omar\\waad_temp_website\\المرافق_المطابقة_النهائي.xlsx";
  await newWb.xlsx.writeFile(outputPath);
  console.log(`✅ تم إنشاء الملف بنجاح: ${outputPath}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
