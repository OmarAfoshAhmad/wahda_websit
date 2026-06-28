import ExcelJS from 'exceljs';

const RELATIONSHIP_CODE_MAP = {
  "زوجة": "W", "زوجه": "W", "الزوجة": "W", "الزوجه": "W", "حرم": "W", "حرمه": "W", "زوجته": "W",
  "زوج": "H", "الزوج": "H", "زوجهما": "H",
  "ابن": "S", "الابن": "S", "إبن": "S", "الإبن": "S", "أبن": "S", "الأبن": "S", "ولد": "S", "الولد": "S", "ولده": "S", "نجل": "S", "النجل": "S",
  "ابنة": "D", "الابنة": "D", "إبنة": "D", "الإبنة": "D", "أبنة": "D", "الأبنة": "D", "ابنته": "D", "بنته": "D", "بنت": "D", "البنت": "D", "كريمة": "D", "الكريمة": "D", "كريمه": "D", "الكريمه": "D", "كريمته": "D", "ابنه": "D", "الابنه": "D", "إبنه": "D", "الإبنه": "D", "أبنه": "D", "الأبنه": "D", "ابه": "D",
  "أم": "M", "ام": "M", "الأم": "M", "الام": "M", "والدة": "M", "والده": "M", "الوالدة": "M", "الوالده": "M", "والدته": "M", "أمه": "M", "امه": "M", "الامه": "M",
  "أب": "F", "اب": "F", "الأب": "F", "الاب": "F", "والد": "F", "الوالد": "F", "والدي": "F", "أبيه": "F", "ابيه": "F",
  "W": "W", "S": "S", "D": "D", "M": "M", "F": "F", "H": "H"
};

const MAIN_ACCOUNT_TERMS = [
  "موظف", "موظفة", "الموظف", "الموظفة", "موظفه", "الموظفه",
  "رب الأسرة", "رب العائلة", "رب أسرة", "رب عائلة", "رب الاسرة", "رب الاسره", "رب العائله", "الاب", "الأب",
  "صاحب البطاقة", "رئيسي", "الرئيسي", "الرئيسية", "الرئيسيه",
  "MAIN", "EMPLOYEE",
  "متوفي", "متوفى", "وفاة", "حالة وفاة",
  "ملحق", "ملحقة", "ملحقه", "الملحق", "الملحقة"
];

async function main() {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile('c:\\Users\\Omar\\waad_temp_website\\card_numbering_template.xlsx');
    const ws = workbook.worksheets[0];
    const rawRows = [];
    
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

    const countsPerEmp = new Map();
    const prefix = "WAB2025";
    const padding = 6;
    
    const results = mappedData.map(item => {
        const empNum = item.employee_number.replace(/^0+/, "");
        const baseCard = prefix + (padding > 0 ? empNum.padStart(padding, "0") : empNum);
        
        let rel = item.relationship;
        const isMain = !rel || MAIN_ACCOUNT_TERMS.includes(rel) || rel.toLowerCase() === "employee";
        
        let finalCardNumber = baseCard;
        if (!isMain) {
            const relCode = RELATIONSHIP_CODE_MAP[rel] || "X";
            const relCountKey = `rel_${empNum}_${relCode}`;
            if (!countsPerEmp.has(relCountKey)) {
                countsPerEmp.set(relCountKey, 0);
            }
            const currentRelCount = countsPerEmp.get(relCountKey) + 1;
            countsPerEmp.set(relCountKey, currentRelCount);
            finalCardNumber = baseCard + relCode + currentRelCount;
        }
        
        return { name: item.name, rel, card: finalCardNumber };
    });

    console.log("First 15 results:");
    console.log(results.slice(0, 15));
}

main().catch(console.error);
