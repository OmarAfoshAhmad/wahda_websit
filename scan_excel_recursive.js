const XLSX = require("xlsx");
const fs = require("fs");
const path = require("path");

const DESKTOP = path.join(process.env.USERPROFILE, "Desktop");
const PATTERNS = ["WAB2025X", "WAB2025XD1", "WAB2025XD2", "WAB2025XD3", "WAB2025XF1", "WAB2025XS1", "WAB2025XS2", "WAB2025XW1"];

function scanExcel(filePath) {
    try {
        const workbook = XLSX.readFile(filePath);
        let found = [];
        workbook.SheetNames.forEach(sheetName => {
            const sheet = workbook.Sheets[sheetName];
            const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });
            data.forEach((row, rowIndex) => {
                row.forEach((cell, colIndex) => {
                    if (cell) {
                        const cellStr = cell.toString().trim();
                        if (PATTERNS.some(p => cellStr.includes(p))) {
                            found.push({ sheet: sheetName, row: rowIndex + 1, col: colIndex + 1, value: cellStr });
                        }
                    }
                });
            });
        });
        return found;
    } catch (e) {
        return null;
    }
}

function traverse(dir) {
    const list = fs.readdirSync(dir);
    list.forEach(file => {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);
        if (stat && stat.isDirectory()) {
            if (file !== "node_modules" && file !== ".git") {
                traverse(fullPath);
            }
        } else if (file.endsWith(".xlsx")) {
            const results = scanExcel(fullPath);
            if (results && results.length > 0) {
                console.log(`MATCH_FOUND: ${fullPath} (${results.length} matches)`);
            }
        }
    });
}

console.log(`Scanning recursively: ${DESKTOP}`);
traverse(DESKTOP);
