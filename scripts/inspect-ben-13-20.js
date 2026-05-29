const XLSX = require('xlsx');
const path = require('path');
const base = 'C:/Users/Omar/Desktop/شركة وعد/بنغازي';
const files = ['BEN_13.xlsx','BEN_14.xlsx','BEN_15_16.xlsx','BEN_17.xlsx','BEN_18.xlsx','BEN_19.xlsx','BEN_20.xlsx'];

function norm(s){return String(s||'').trim();}
function pick(keys, re){return keys.find(k=>re.test(String(k)));}

for (const f of files){
  const p = path.join(base,f);
  const wb = XLSX.readFile(p,{cellDates:true});
  console.log('\n===== '+f+' =====');
  for (const sn of wb.SheetNames){
    const ws = wb.Sheets[sn];
    const rows = XLSX.utils.sheet_to_json(ws,{defval:''});
    const keys = rows[0]?Object.keys(rows[0]):[];
    const cardCol = pick(keys, /(رقم\s*البطاقة|card|insurance profile|\bbarcode\b|الباركود)/i);
    const empCol = pick(keys, /(emp\s*no|employee\s*no|employee\s*number|الرقم\s*الوظيفي|رقم\s*الموظف|رقم\s*الوظيفي|EMPNO)/i);
    const relCol = pick(keys, /(صلة\s*القرابة|relationship|status|الصلة|relation|المستفيد|FN|SN)/i);
    console.log('Sheet:',sn,'Rows:',rows.length,'Cols:',keys.length);
    console.log('cardCol=',cardCol||'-','empCol=',empCol||'-','relCol=',relCol||'-');
    if (rows.length){
      for(let i=0;i<Math.min(6,rows.length);i++){
        const r=rows[i];
        const card = cardCol?norm(r[cardCol]):'';
        const emp = empCol?norm(r[empCol]):'';
        const rel = relCol?norm(r[relCol]):'';
        if(card||emp||rel) console.log('  row',i+2, {emp, rel, card});
      }
    }
  }
}
