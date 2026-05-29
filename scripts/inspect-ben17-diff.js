const XLSX=require('xlsx');
const wb=XLSX.readFile('C:/Users/Omar/Desktop/شركة وعد/بنغازي/BEN_17.xlsx');
const rows=XLSX.utils.sheet_to_json(wb.Sheets['ترميز البطاقات'],{defval:''});
let diff=0, c2empty=0, c1only=0, plus1=0;
for(let i=0;i<rows.length;i++){
 const b=String(rows[i]['الباركود']||'').trim();
 const c=String(rows[i]['رقم البطاقة']||'').trim();
 const rel=String(rows[i]['صلة القرابة']||'').trim();
 const emp=String(rows[i]['الرقم الوظيفي']||'').replace(/\D+/g,'');
 if(!b&&!c) continue;
 if(!c) c2empty++;
 if(b && !c) c1only++;
 if(b&&c&&b!==c) diff++;
 const m=b.match(/^(WAB2025\d+)([A-Z]\d*)?$/i);
 if(m && emp && /موظف|موظفة/.test(rel)){
   const base=m[1].replace('WAB2025','');
   if(base.endsWith(emp+'1')) plus1++;
 }
}
console.log({rows:rows.length,diff,c2empty,c1only,plus1});
