import ExcelJS from 'exceljs';

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

    const results = rawRows.filter(row => {
        const vals = Object.values(row).join(' ');
        return vals.includes('سميرة عطية') || vals.includes('سميرة أحمد') || vals.includes('حنان ميلود') || vals.includes('آلاء ميلاد');
    });

    console.log(results);
}

main().catch(console.error);
