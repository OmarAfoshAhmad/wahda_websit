const XLSX=require('xlsx');
const base='C:/Users/Omar/Desktop/شركة وعد/بنغازي/مصحح_دفعات_13_20_2026-05-25T16-51-56-537Z';
function show(file,sheet,rowNums,cardCols){
 const wb=XLSX.readFile(`${base}/${file}`);
 const rows=XLSX.utils.sheet_to_json(wb.Sheets[sheet],{defval:''});
 console.log('\n==',file,sheet,'==');
 for(const rn of rowNums){
   const r=rows[rn-2];
   if(!r) continue;
   const out={row:rn,status:r.Status||r['المستفيد']||r['صلة القرابة']||'',emp:r.EMPNO||r['رقم الوظيفي']||r['الرقم الوظيفي']||'',main:r.EMP_No_Main||'',rel:r['صلة القرابة']||r['المستفيد']||r.Status||''};
   for(const c of cardCols) out[c]=r[c];
   console.log(out);
 }
}
show('BEN_13_corrected.xlsx','1',[60,61,128,133,145,155,156,171,172,179,180],['Insurance Profile-','Insurance Profile']);
show('BEN_15_16_corrected.xlsx','ترميز البطاقات',[3,4,5,6,39,63,71,83,106,113,116],['الباركود','الباركود_1']);
show('BEN_17_corrected.xlsx','ترميز البطاقات',[2,5,13,21,31,38],['الباركود','رقم البطاقة']);
