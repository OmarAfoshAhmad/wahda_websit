const fs = require('fs');

let file = 'src/app/actions/beneficiary.ts';
let code = fs.readFileSync(file, 'utf8');

const regex = /export async function mergeDuplicateManualSelectionAction[\s\S]*?strategy: "ZERO_PRIORITY",\s*\n\s*\}\);?\s*}/g;

const newLogic = `export async function mergeDuplicateManualSelectionAction(formData: FormData) {
  const session = await requireActiveFacilitySession();
  if (!session || !hasPermission(session, "delete_beneficiary")) {
    return { error: "غير مصرح بهذه العملية" };
  }

  const memberIds = [...new Set(formData.getAll("member_ids").map((v) => String(v).trim()).filter(Boolean))];
  if (memberIds.length === 0) return { error: "لم يتم العثور على سجلات" };

  // خريطة لتجميع السجلات المراد دمجها حسب السجل المستهدف (المرجع)
  const targetMap = new Map<string, string[]>();

  for (const memberId of memberIds) {
    const targetId = String(formData.get(\`action_\${memberId}\`) ?? "").trim();
    if (!targetId || !memberIds.includes(targetId)) return { error: "إجراء غير صحيح لأحد السجلات" };
    
    if (targetId !== memberId) {
      if (!targetMap.has(targetId)) targetMap.set(targetId, []);
      targetMap.get(targetId)!.push(memberId);
    }
  }

  let totalMerged = 0;

  for (const [keepId, explicitMergeIds] of targetMap.entries()) {
    if (explicitMergeIds.length > 0) {
      const res = await mergeDuplicateBeneficiaries(keepId, {
        forceKeep: true,
        explicitMergeIds,
        candidateIds: [keepId, ...explicitMergeIds],
        strategy: "ZERO_PRIORITY",
      });
      if (res.error) return res;
      totalMerged += (res.mergedCount ?? 0);
    }
  }

  return { mergedCount: totalMerged };
}`;

if (code.match(regex)) {
  code = code.replace(regex, newLogic);
  
  const regex2 = /export async function mergeNeedsReviewGroupAction[\s\S]*?strategy: "ZERO_PRIORITY",\s*\n\s*\}\);?\s*}/g;
  if(code.match(regex2)) {
    code = code.replace(regex2, `export const mergeNeedsReviewGroupAction = mergeDuplicateManualSelectionAction;`);
  } else {
    code += `\nexport const mergeNeedsReviewGroupAction = mergeDuplicateManualSelectionAction;`;
  }
  
  fs.writeFileSync(file, code);
  console.log("Updated beneficiary actions!");
} else {
  console.log("Regex mismatched!");
}
