const XLSX = require('xlsx');
const path = require('path');

const defaultBase='C:/Users/Omar/Desktop/شركة وعد/بنغازي';
const defaultFiles=['BEN_13.xlsx','BEN_14.xlsx','BEN_15_16.xlsx','BEN_17.xlsx','BEN_18.xlsx','BEN_19.xlsx','BEN_20.xlsx'];
const base=process.argv[2] || defaultBase;
const files=process.argv.length>3 ? process.argv.slice(3) : defaultFiles;

const employeeWords=['موظف','موظفة','رب الأسرة','موظف متقاعد','متقاعد','صاحب البطاقة','صاحبالبطاقة'];
const fatherWords=new Set(['اب','الاب','ابو','والد']);
const motherWords=new Set(['ام','الام','والدة','والده']);
const REL_HEADER_STRONG_REGEX=/(status|صلة|القرابة|relationship|relation|الصلة)/i;
const REL_HEADER_WEAK_REGEX=/^المستفيد$/i;

function clean(v){return String(v??'').trim();}
function digits(v){return clean(v).replace(/\D+/g,'');}
function normStatus(v){
  return clean(v)
    .toLowerCase()
    .replace(/[أإآ]/g,'ا')
    .replace(/ى/g,'ي')
    .replace(/ة/g,'ه')
    .replace(/[\s_\-]+/g,'');
}
function isEmployee(st){
  const s=normStatus(st);
  if(!s) return false;
  return employeeWords.some(w=>s.includes(normStatus(w)));
}
function isFather(st){
  const s=normStatus(st);
  return fatherWords.has(s);
}
function isMother(st){
  const s=normStatus(st);
  return motherWords.has(s);
}
function baseFromCard(c){const m=clean(c).toUpperCase().match(/^(WAB2025\d+)/);return m?m[1]:'';}

function detectRelationColumn(keys,rows){
  let strong = null;
  let weak = null;
  for(const k of keys){
    const key = clean(k);
    if(REL_HEADER_STRONG_REGEX.test(key)){
      strong = k;
      break;
    }
    if(REL_HEADER_WEAK_REGEX.test(key)){
      weak = k;
    }
  }
  const candidate = strong ?? weak;
  if(!candidate) return null;

  let nonEmpty = 0;
  let relationLike = 0;
  const sample = rows.slice(0,200);
  for(const r of sample){
    const value = clean(r[candidate]);
    if(!value) continue;
    nonEmpty += 1;
    const n = normStatus(value);
    if(
      isEmployee(value) ||
      isFather(value) ||
      isMother(value) ||
      n.includes('زوج') ||
      n.startsWith('ابن') ||
      n.startsWith('ابنه')
    ){
      relationLike += 1;
    }
  }
  if(nonEmpty===0) return null;
  const score = relationLike / nonEmpty;
  if(strong) return score >= 0.1 ? candidate : null;
  return score >= 0.35 ? candidate : null;
}

function detect(file,sn,rows){
  const keys=rows[0]?Object.keys(rows[0]):[];
  const cardCols=keys.filter(k=>/(رقم\s*البطاقة|insurance\s*profile|\bbarcode\b|الباركود|card_number|card\s*number|رقم\s*البطاقة_?)/i.test(k));
  const empCol=keys.find(k=>/(emp\s*no|employee\s*no|employee\s*number|الرقم\s*الوظيفي|رقم\s*الموظف|رقم\s*الوظيفي|EMPNO|EMP_No_Main|رقم الوظيفي|الرقم الوظيفي)/i.test(k));
  const relCol=detectRelationColumn(keys,rows);
  let issues=[];
  for(let i=0;i<rows.length;i++){
    const r=rows[i];
    const rowNo=i+2;
    const rel=relCol?clean(r[relCol]):'';
    const emp=empCol?digits(r[empCol]):'';
    const cards=cardCols.map(c=>({col:c,val:clean(r[c])})).filter(x=>x.val);
    if(cards.length===0) continue;

    // card disagreement بين عمودين
    if(cards.length>1){
      const vals=[...new Set(cards.map(c=>c.val.toUpperCase()))];
      if(vals.length>1){
        issues.push({type:'card_mismatch_cols',file,sheet:sn,row:rowNo,rel,emp,details:cards});
      }
    }

    const card=cards[0].val.toUpperCase();
    if(!card.startsWith('WAB2025')) continue;

    if(emp && isEmployee(rel)){
      const base=baseFromCard(card);
      if(base && base.endsWith('1')){
        const trimmed=base.slice(0,-1);
        if(trimmed.endsWith(emp)){
          issues.push({type:'employee_plus_one',file,sheet:sn,row:rowNo,rel,emp,card,expectedBase:trimmed});
        }
      }
    }

    if(isFather(rel)){
      if(/^(WAB2025\d+)$/.test(card)){
        issues.push({type:'father_missing_suffix',file,sheet:sn,row:rowNo,rel,emp,card,suggest:card+'F1'});
      }
      if(/W1$|M1$/i.test(card)){
        issues.push({type:'father_wrong_suffix',file,sheet:sn,row:rowNo,rel,emp,card});
      }
    }

    if(isMother(rel)){
      if(/^(WAB2025\d+)$/.test(card)){
        issues.push({type:'mother_missing_suffix',file,sheet:sn,row:rowNo,rel,emp,card,suggest:card+'M1'});
      }
      if(/W1$|F1$/i.test(card)){
        issues.push({type:'mother_wrong_suffix',file,sheet:sn,row:rowNo,rel,emp,card});
      }
    }
  }
  return {issues,cardCols,empCol,relCol};
}

for(const f of files){
  const wb=XLSX.readFile(path.join(base,f),{cellDates:true});
  console.log('\n====',f,'====');
  let total=0;
  for(const sn of wb.SheetNames){
    const rows=XLSX.utils.sheet_to_json(wb.Sheets[sn],{defval:''});
    const d=detect(f,sn,rows);
    if(d.issues.length){
      total+=d.issues.length;
      console.log('Sheet',sn,'issues',d.issues.length,'cardCols',d.cardCols,'empCol',d.empCol,'relCol',d.relCol);
      for(const it of d.issues.slice(0,10)) console.log(' ',it);
      if(d.issues.length>10) console.log('  ...');
    }
  }
  console.log('total issues',total);
}
