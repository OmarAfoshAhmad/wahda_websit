"use server";

import { redirect } from "next/navigation";
import { mergeDuplicateManualSelectionAction } from "@/app/actions/beneficiary";

export async function bulkManualMergeAction(formData: FormData) {
  let mergedCount = 0;
  let errorMsg = "";

  const payloadsJson = String(formData.get("payloads") ?? "[]");
  let payloadsData: Record<string, string | string[]>[] = [];
  try {
    payloadsData = JSON.parse(payloadsJson);
  } catch (err) {
    return redirect(`/admin/duplicates?err=بيانات الدفعة غير صالحة`);
  }

  for (const data of payloadsData) {
    try {
      // Reconstruct FormData for mergeDuplicateManualSelectionAction
      const singleFormData = new FormData();
      for (const [key, value] of Object.entries(data)) {
        if (Array.isArray(value)) {
          value.forEach(v => singleFormData.append(key, v));
        } else {
          singleFormData.append(key, value);
        }
      }

      const result = await mergeDuplicateManualSelectionAction(singleFormData);
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
  if (payloadsData.length > 0) {
    const firstPayload = payloadsData[0];
    const getSingleValue = (key: string) => {
      const val = firstPayload[key];
      return Array.isArray(val) ? val[0] : val;
    };

    const q = String(getSingleValue("q") ?? "");
    const pz = String(getSingleValue("pz") ?? "1");
    const pn = String(getSingleValue("pn") ?? "1");
    const tab = String(getSingleValue("tab") ?? "review");
    const companyId = String(getSingleValue("companyId") ?? "");

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
