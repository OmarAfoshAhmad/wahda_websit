const XLSX=require('xlsx');
const wb=XLSX.readFile('C:/Users/Omar/Desktop/شركة وعد/بنغازي/BEN_15_16.xlsx');
const rows=XLSX.utils.sheet_to_json(wb.Sheets['ترميز البطاقات'],{defval:''});
let diff=0, c2empty=0, c2nonempty=0;
for(const r of rows){
 const b=String(r['الباركود']||'').trim();
 const c=String(r['الباركود_1']||'').trim();
 if(c) c2nonempty++; else c2empty++;
 if(b&&c&&b!==c) diff++;
}
console.log({rows:rows.length,c2nonempty,c2empty,diff});
