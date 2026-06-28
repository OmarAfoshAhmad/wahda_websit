import ExcelJS from 'exceljs';

async function main() {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile('c:\\Users\\Omar\\waad_temp_website\\card_numbering_template.xlsx');
    const ws = workbook.worksheets[0];
    
    ws.eachRow((row, rowNumber) => {
        if (rowNumber > 50 && rowNumber < 70) {
            console.log(`Row ${rowNumber}:`, row.values);
        }
    });
}

main().catch(console.error);
