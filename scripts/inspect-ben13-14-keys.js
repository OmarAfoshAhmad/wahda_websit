const XLSX = require('xlsx');
const path = require('path');
const base='C:/Users/Omar/Desktop/شركة وعد/بنغازي';
for (const file of ['BEN_13.xlsx','BEN_14.xlsx']){
  const wb=XLSX.readFile(path.join(base,file));
  const ws=wb.Sheets[wb.SheetNames[0]];
  const rows=XLSX.utils.sheet_to_json(ws,{defval:''});
  const keys=rows[0]?Object.keys(rows[0]):[];
  console.log('\n',file,'keys=',keys);
  for (const k of keys){
    if(/FN|Status|status|Relationship|relation|صلة|SN|EMPNO/i.test(k)){
      const vals=[...new Set(rows.map(r=>String(r[k]??'').trim()).filter(Boolean))];
      console.log(' ',k,'sample:',vals.slice(0,12));
    }
  }
  console.log('first row full',rows[0]);
  console.log('row2 full',rows[1]);
}
