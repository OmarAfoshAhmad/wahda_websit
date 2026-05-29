const XLSX=require('xlsx');
for(const f of ['BEN_13.xlsx']){
 const wb=XLSX.readFile('C:/Users/Omar/Desktop/شركة وعد/بنغازي/'+f);
 const rows=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{defval:''});
 let diff=0;
 for(const r of rows){
  const a=String(r['Insurance Profile-']||'').trim();
  const b=String(r['Insurance Profile']||'').trim();
  if(a&&b&&a!==b) diff++;
 }
 console.log(f,{rows:rows.length,diff});
}
