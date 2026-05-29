const XLSX=require('xlsx');const wb=XLSX.readFile('C:/Users/Omar/Desktop/شركة وعد/بنغازي/BEN_13.xlsx');
const rows=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{defval:''});
for(const target of [128,133,145,155,161,171,172,179]){
  const idx=target-2;const r=rows[idx];
  const main=String(r.EMP_No_Main||'').trim();
  console.log('\nTarget row',target,'main',main,'status',r.Status,'card',r['Insurance Profile-']);
  for(let j=Math.max(0,idx-2);j<=Math.min(rows.length-1,idx+2);j++){
    const x=rows[j];
    if(String(x.EMP_No_Main||'').trim()===main) console.log(' ',j+2,{status:x.Status,emp:x.EMPNO,card:x['Insurance Profile-']});
  }
}
