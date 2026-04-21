const XLSX = require("xlsx");
const workbook = XLSX.readFile("reports/db-anomalies-review-2026-04-21T16-45-38.xlsx");
workbook.SheetNames.forEach(name => {
    console.log("Sheet:", name);
    const data = XLSX.utils.sheet_to_json(workbook.Sheets[name]);
    if (data.length > 0) console.log("First row:", data[0]);
});
