import ExcelJS from 'exceljs';

async function main() {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile('c:\\Users\\Omar\\waad_temp_website\\card_numbering_template.xlsx');
    const worksheet = workbook.worksheets[0];
    const data = [];
    let i = 0;
    worksheet.eachRow((row, rowNumber) => {
        if (i < 5) {
            console.log(`Row ${rowNumber}:`, row.values);
        }
        i++;
    });
}

main().catch(console.error);
