const XLSX = require("xlsx");
const workbook = XLSX.readFile("reports/db-anomalies-review-2026-04-21T16-51-31.xlsx");
const worksheet = workbook.Sheets["تفاصيل التشوهات"];
const data = XLSX.utils.sheet_to_json(worksheet);

const targetCategories = ["DRIFT_BALANCE", "OVERDRAWN_DEBT"];
const counts = { DRIFT_BALANCE: 0, OVERDRAWN_DEBT: 0 };
const overdrawnReasons = [];

data.forEach(row => {
    const category = row["category"];
    if (targetCategories.includes(category)) {
        counts[category]++;
        if (category === "OVERDRAWN_DEBT" && overdrawnReasons.length < 2) {
            overdrawnReasons.push(row["reason"]);
        }
    }
});

console.log(JSON.stringify({ counts, overdrawnReasons }, null, 4));
