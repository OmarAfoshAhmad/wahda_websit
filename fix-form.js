const fs = require('fs');

let file = 'src/components/duplicate-manual-merge-form.tsx';
let code = fs.readFileSync(file, 'utf8');

const regexKeepId = /const initialKeep = members\.some\(\(m\) => m\.id === preferredId\) \? preferredId : members\[0\]\?\.id \?\? "";[\s\S]*?const \[keepId, setKeepId\] = useState\(initialKeep\);/g;

const newStates = `const [actions, setActions] = useState<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    const getBase = (n: string) => n.replace(/[^A-Za-z0-9]/g, "").replace(/[A-Za-z]+$/, "").toUpperCase();
    
    const prefMember = members.find(m => m.id === preferredId);
    const prefBaseCard = prefMember ? getBase(prefMember.card_number) : "";

    members.forEach(m => {
      // Default to merge if base cards perfectly match, otherwise keep independent
      if (prefBaseCard && getBase(m.card_number) === prefBaseCard && members.length > 1) {
        map[m.id] = preferredId;
      } else {
        map[m.id] = m.id;
      }
    });
    return map;
  });`;

code = code.replace(regexKeepId, newStates);

const tableHeadRegex = /<th className="py-1 px-2">إبقاء<\/th>[\s\S]*?<th className="py-1 px-2">القرار<\/th>\s*<\/tr>/g;
const newTableHead = `<th className="py-1 px-2 w-[220px]">الإجراء المخصص</th>
              <th className="py-1 px-2">الاسم</th>
              <th className="py-1 px-2">رقم البطاقة</th>
              <th className="py-1 px-2">رب الأسرة</th>
              <th className="py-1 px-2">الصلة</th>
              <th className="py-1 px-2">الرصيد</th>
              <th className="py-1 px-2">الحالة</th>
              <th className="py-1 px-2">تاريخ الميلاد</th>
              <th className="py-1 px-2">المعاملات</th>
              <th className="py-1 px-2 text-left">تعديل</th>
            </tr>`;

code = code.replace(tableHeadRegex, newTableHead);

const tableRowRegex = /<td className="py-1 px-2">\s*<input[\s\S]*?aria-label=\{.*\}[\s\S]*?\/>\s*<\/td>([\s\S]*?)<td className="py-1 px-2">\s*<div className="flex items-center gap-2">[\s\S]*?<\/div>\s*<\/td>/g;

const newTableRow = `<td className="py-1 px-2">
                    <select
                      name={\`action_\${m.id}\`}
                      value={actions[m.id]}
                      onChange={(e) => setActions({ ...actions, [m.id]: e.target.value })}
                      className={\`w-full text-xs py-1.5 px-2 rounded-md border focus:outline-none focus:ring-1 bg-white dark:bg-slate-900 \${
                        actions[m.id] === m.id 
                          ? "border-emerald-300 focus:border-emerald-500 focus:ring-emerald-500 font-bold text-emerald-700 dark:text-emerald-400"
                          : "border-red-300 focus:border-red-500 focus:ring-red-500 font-bold text-red-600 dark:text-red-400"
                      }\`}
                    >
                      <option value={m.id}>🟢 إبقاء كشخص مستقل</option>
                      {members.filter(t => t.id !== m.id).map(t => (
                        <option key={\`target-\${t.id}\`} value={t.id}>
                          🔴 دمج مع ⟵ {t.card_number}
                        </option>
                      ))}
                    </select>
                  </td>$1`;

code = code.replace(tableRowRegex, newTableRow);

// Replace the helper text default to be more context aware
const helperTextRegex = /"اختر سجلًا واحدًا للإبقاء، والباقي سيتم حذفه ناعمًا تلقائيًا"/g;
code = code.replace(helperTextRegex, '"تحكم بمسار كل بطاقة: إبقاء كشخص مستقل، أو تحويل معاملاتها وحذفها ناعماً بدمجها مع بطاقة أخرى."');

// Also remove `const isKeep = keepId === m.id;` from the render loop
const isKeepRegex = /const isKeep = keepId === m\.id;\n?\s*/g;
code = code.replace(isKeepRegex, "");

fs.writeFileSync(file, code);
console.log("Updated form UI!");