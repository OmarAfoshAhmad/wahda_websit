const XLSX = require("xlsx");
const workbook = XLSX.readFile("reports/db-anomalies-review-2026-04-21T16-45-38.xlsx");
const sheetName = workbook.SheetNames[0];
const worksheet = workbook.Sheets[sheetName];
const data = XLSX.utils.sheet_to_json(worksheet);
if (data.length > 0) {
    console.log("Keys found:", Object.keys(data[0]));
} else {
    console.log("No data found in sheet");
}

const counts = {};
data.forEach(row => {
    // Try to find any key that might be the anomaly type
    let anomaly = null;
    for (let key in row) {
        if (key.toLowerCase().includes("anomaly") || key.includes("انحراف") || key.includes("شذوذ")) {
            anomaly = row[key];
            break;
        }
    }
    if (anomaly) {
        counts[anomaly] = (counts[anomaly] || 0) + 1;
    }
});

const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
console.log("Top 5:", JSON.stringify(sorted.slice(0, 5), null, 2));
