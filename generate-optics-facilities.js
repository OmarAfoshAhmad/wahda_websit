const ExcelJS = require('exceljs');

(async () => {
  const normalizedFacilities = [
    { name: "مجموعة الجهمي للبصريات", username: "aljahmi_eye" },
    { name: "شركة ساطي للبصريات", username: "sati_eye" },
    { name: "دلتا للبصريات", username: "delta_eye" },
    { name: "21 للبصريات", username: "twenty_one_eye" },
    { name: "برنيق الجديد للبصريات", username: "berniq_eye" },
    { name: "الرؤية للبصريات", username: "roaya_eye" },
    { name: "الأنيس للبصريات", username: "alanis_eye" },
    { name: "الأمل للشفاء للبصريات", username: "alamal_eye" },
    { name: "مركز ليتوريا للبصريات", username: "letoria_eye" },
    { name: "مكين للبصريات", username: "makeen_eye" },
    { name: "مركز رشاد للبصريات", username: "rashad_eye" },
    { name: "المتقدم للبصريات", username: "motakadem_eye" },
    { name: "ابن سينا للبصريات", username: "ibnsina_eye" },
    { name: "بوراوي للبصريات", username: "borawi_eye" },
    { name: "بصريات الشريف", username: "alshareef_eye" },
    { name: "أبو النجا للبصريات", username: "abonaja_eye" },
    { name: "الوصال للبصريات", username: "alwesal_eye" },
    { name: "مركز درنة الطبي", username: "derna_medical_eye" },
    { name: "مركز الحكيم للبصريات", username: "alhakim_eye" },
    { name: "الأميرة للنظارات", username: "alamira_eye" }
  ];

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("قالب المرافق");

  sheet.views = [{ rightToLeft: true }];

  sheet.columns = [
    { header: "اسم المرفق", key: "name", width: 40 },
    { header: "اسم المستخدم", key: "username", width: 25 },
  ];

  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, size: 12 };
  headerRow.alignment = { horizontal: "center" };

  for (const facility of normalizedFacilities) {
    sheet.addRow({
      name: facility.name,
      username: facility.username
    });
  }

  const filePath = 'c:/Users/Omar/waad_temp_website/مرافق_البصريات_للاستيراد.xlsx';
  await workbook.xlsx.writeFile(filePath);
  console.log('File created successfully:', filePath);
})();
