const XLSX = require("xlsx");
const workbook = XLSX.readFile("reports/db-anomalies-review-2026-04-21T16-45-38.xlsx");
const worksheet = workbook.Sheets["تفاصيل التشوهات"];
const data = XLSX.utils.sheet_to_json(worksheet);

const counts = {};
data.forEach(row => {
    const category = row["category"];
    if (category) {
        counts[category] = (counts[category] || 0) + 1;
    }
});

const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
console.log(JSON.stringify(sorted.slice(0, 5), null, 4));
