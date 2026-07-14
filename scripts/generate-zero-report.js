
const { PrismaClient } = require("@prisma/client");
const ExcelJS = require("exceljs");
const fs = require("fs");
const path = require("path");

const prisma = new PrismaClient();

async function main() {
    console.log("Fetching zero-balance beneficiaries...");
    const zeroed = await prisma.beneficiary.findMany({
        where: { remaining_balance: 0, deleted_at: null },
        select: { card_number: true, name: true }
    });
    console.log(`Found ${zeroed.length} zero-balance beneficiaries.`);

    const desktopPath = "C:\\Users\\Omar\\Desktop";
    const cardToFiles = new Map();

    const scanFiles = (dir) => {
        const results = [];
        const files = fs.readdirSync(dir);
        for (const file of files) {
            const fullPath = path.join(dir, file);
            if (fs.statSync(fullPath).isDirectory()) {
                if (file === "node_modules" || file === ".git") continue;
                results.push(...scanFiles(fullPath));
            } else if (file.toLowerCase().endsWith(".xlsx")) {
                results.push(fullPath);
            }
        }
        return results;
    };

    console.log("Scanning Desktop for Excel files...");
    const excelFiles = scanFiles(desktopPath);
    console.log(`Found ${excelFiles.length} Excel files to scan.`);

    for (const filePath of excelFiles) {
        const fileName = path.basename(filePath);
        console.log(`Processing ${fileName}...`);
        try {
            const workbook = new ExcelJS.Workbook();
            await workbook.xlsx.readFile(filePath);
            workbook.eachSheet((sheet) => {
                sheet.eachRow((row) => {
                    row.eachCell((cell) => {
                        const val = String(cell.value || "").trim().toUpperCase();
                        if (val.includes("WAB2025")) {
                            // Extract WAB2025XXXX
                            const match = val.match(/WAB2025[0-9A-Z]+/);
                            if (match) {
                                const card = match[0];
                                if (!cardToFiles.has(card)) {
                                    cardToFiles.set(card, new Set());
                                }
                                cardToFiles.get(card).add(fileName);
                            }
                        }
                    });
                });
            });
        } catch (e) {
            console.error(`Error reading ${fileName}: ${e.message}`);
        }
    }

    console.log("Generating report...");
    const reportWorkbook = new ExcelJS.Workbook();
    const ws = reportWorkbook.addWorksheet("تقرير المصفرين");
    ws.columns = [
        { header: "الاسم", key: "name", width: 30 },
        { header: "رقم البطاقة", key: "card", width: 20 },
        { header: "الملفات التي ذكر فيها", key: "sources", width: 60 }
    ];

    for (const ben of zeroed) {
        const card = ben.card_number.toUpperCase();
        const sources = cardToFiles.get(card);
        ws.addRow({
            name: ben.name,
            card: ben.card_number,
            sources: sources ? Array.from(sources).join(", ") : "غير موجود في ملفات سطح المكتب"
        });
    }

    const outputPath = path.join(desktopPath, "تقرير_المصفرين_بالمصادر.xlsx");
    await reportWorkbook.xlsx.writeFile(outputPath);
    console.log(`Report saved to ${outputPath}`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
