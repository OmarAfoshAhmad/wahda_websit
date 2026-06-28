import ExcelJS from 'exceljs';

async function main() {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile('c:\\Users\\Omar\\waad_temp_website\\card_numbering_template.xlsx');
    const ws = workbook.worksheets[0];
    const rawRows = [];
    
    // Simulate what XLSX.utils.sheet_to_json does
    ws.eachRow((row, rowNumber) => {
        const rowObj = {};
        row.eachCell((cell, colNumber) => {
            const headerCell = ws.getRow(1).getCell(colNumber);
            rowObj[headerCell.value] = cell.value;
        });
        rawRows.push(rowObj);
    });

    let lastEmpNum = ""; 
    const mappedData = rawRows.map((row, index) => {
        if (index === 0) return null; // skip header
        
        const keys = Object.keys(row);
        const values = Object.values(row).map(v => String(v || "").trim());
        
        const findKey = (keywords) => 
            keys.find(k => {
                const strK = String(k).trim();
                return keywords.some(kw => strK === kw || strK.includes(kw));
            });

        const nameKey = findKey(["الأسم", "الاسم", "الإسم", "اسم المستفيد"]);
        const relKey = findKey(["صلة", "القرابة", "Relationship", "النوع", "الصلة", "Rel"]);
        const empNumKey = findKey(["الرقم الوظيفي", "رقم الوظيفي", "وظيفي", "رقم الموظف"]);

        let name = nameKey ? row[nameKey] : "";
        let rel = relKey ? row[relKey] : "";
        let empNum = "";

        let extractedEmpNum = empNumKey ? String(row[empNumKey] || "").trim() : "";
        
        if (extractedEmpNum) {
            empNum = extractedEmpNum;
            lastEmpNum = empNum;
        } else if (lastEmpNum) {
            empNum = lastEmpNum;
        }

        return {
            name: String(name || "").trim(),
            employee_number: String(empNum || "").trim(),
            relationship: String(rel || "").trim(),
        };
    }).filter(item => item && item.name && item.name.length > 2);

    console.log("First 10 parsed rows:");
    console.log(mappedData.slice(0, 10));
}

main().catch(console.error);
