const XLSX=require('xlsx');const path=require('path');
const wb=XLSX.readFile('C:/Users/Omar/Desktop/شركة وعد/بنغازي/BEN_13.xlsx');
const rows=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{defval:''});
for(let i=0;i<rows.length;i++){
 const r=rows[i];
 const emp=String(r.EMPNO||'').trim();
 const main=String(r.EMP_No_Main||'').trim();
 if(emp==='720'||main==='720'||String(r['Insurance Profile-']).includes('0720')){
   console.log(i+2,{status:r.Status,emp,main,card:r['Insurance Profile-']});
 }
}
