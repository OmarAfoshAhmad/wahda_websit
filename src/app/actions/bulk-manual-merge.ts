"use server";

import { redirect } from "next/navigation";
import { mergeDuplicateManualSelectionAction } from "@/app/actions/beneficiary";

export async function bulkManualMergeAction(payloads: FormData[]) {
  let mergedCount = 0;
  let errorMsg = "";

  for (const formData of payloads) {
    try {
      const result = await mergeDuplicateManualSelectionAction(formData);
      if (result && "error" in result && result.error) {
        errorMsg = result.error;
        break; // Stop on first error
      } else {
        const sr = result as { mergedCount?: number };
        mergedCount += sr?.mergedCount ?? 0;
      }
    } catch (err: any) {
      errorMsg = err.message || "حدث خطأ غير متوقع أثناء المعالجة";
      break;
    }
  }

  // To redirect properly we extract params from the first payload
  if (payloads.length > 0) {
    const formData = payloads[0];
    const q = String(formData.get("q") ?? "");
    const pz = String(formData.get("pz") ?? "1");
    const pn = String(formData.get("pn") ?? "1");
    const tab = String(formData.get("tab") ?? "review");
    const companyId = String(formData.get("companyId") ?? "");

    const params = new URLSearchParams();
    if (companyId) params.set("companyId", companyId);
    if (q) params.set("q", q);
    params.set("pz", pz);
    params.set("pn", pn);
    params.set("tab", tab);

    if (errorMsg) {
      params.set("err", `تم دمج ${mergedCount} قبل حدوث خطأ: ${errorMsg}`);
    } else {
      params.set("ok", `تم الدمج المخصص بنجاح (${mergedCount} سجلات) لجميع التحديدات.`);
    }
    
    redirect(`/admin/duplicates?${params.toString()}`);
  }
}
