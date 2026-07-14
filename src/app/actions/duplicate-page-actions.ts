"use server";

import { redirect } from "next/navigation";
import {
  mergeDuplicateGroupByCanonicalAction,
  mergeDuplicateManualSelectionAction,
  mergeDuplicateBatchByConditionAction,
  mergeNeedsReviewGroupAction,
  mergeNeedsReviewBatchAction,
  undoMergeDuplicateBeneficiariesByAuditId,
  ignoreDuplicatePairAction,
} from "@/app/actions/beneficiary";

export async function mergeGroupAction(formData: FormData) {
  const q = String(formData.get("q") ?? "");
  const pz = String(formData.get("pz") ?? "1");
  const pn = String(formData.get("pn") ?? "1");
  const tab = String(formData.get("tab") ?? "review");

  const params = new URLSearchParams();
  if (q) params.set("q", q);
  params.set("pz", pz);
  params.set("pn", pn);
  params.set("tab", tab);

  const result = await mergeDuplicateGroupByCanonicalAction(formData);
  if (result.error) {
    params.set("err", result.error);
    redirect(`/admin/duplicates?${params.toString()}`);
  }

  const successResult = result as { mergedCount?: number; mergeAuditId?: string };
  params.set("ok", `تم الدمج بنجاح (${successResult.mergedCount ?? 0} سجلات فرعية)`);
  if (successResult.mergeAuditId) {
    params.set("audit", successResult.mergeAuditId);
  }
  redirect(`/admin/duplicates?${params.toString()}`);
}

export async function mergeManualAction(formData: FormData) {
  const result = await mergeDuplicateManualSelectionAction(formData);
  if ("error" in result && result.error) return { error: result.error };
  const sr = result as { mergedCount?: number; mergeAuditId?: string };
  return { ok: `تم الدمج المخصص بنجاح (${sr.mergedCount ?? 0} سجلات)` };
}

export async function mergeBatchAction(formData: FormData) {
  const q = String(formData.get("q") ?? "");
  const pz = String(formData.get("pz") ?? "1");
  const pn = String(formData.get("pn") ?? "1");
  const tab = String(formData.get("tab") ?? "review");

  const params = new URLSearchParams();
  if (q) params.set("q", q);
  params.set("pz", pz);
  params.set("pn", pn);
  params.set("tab", tab);

  try {
    const res = await mergeDuplicateBatchByConditionAction(formData);
    if (res?.error) {
      params.set("err", res.error);
    } else {
      const truncatedCount = Number(res?.truncatedCount ?? 0);
      params.set("ok", truncatedCount > 0 ? `success_batch_limited_${truncatedCount}` : "success_batch");
      if (res?.mergedGroups) params.set("merged", String(res.mergedGroups));
      if (res?.batchTotalRows) params.set("before", String(res.batchTotalRows));
      if (res?.mergedRows) params.set("after", String(res.batchTotalRows - res.mergedRows));
      if (res?.firstAuditId) params.set("audit", res.firstAuditId);
    }
  } catch {
    params.set("err", "تعذر معالجة الدفعة حالياً. تم تقليل حجم الدفعة؛ أعد المحاولة.");
  }
  redirect(`/admin/duplicates?${params.toString()}`);
}

export async function mergeAuditGroupAction(formData: FormData) {
  const result = await mergeNeedsReviewGroupAction(formData);
  if ("error" in result && result.error) return { error: result.error };
  const sr = result as { mergedCount?: number; mergeAuditId?: string };
  return { ok: `تمت معالجة السجل بنجاح (${sr.mergedCount ?? 0} سجلات)` };
}

export async function mergeAuditGroupRedirectAction(formData: FormData) {
  const q = String(formData.get("q") ?? "");
  const pz = String(formData.get("pz") ?? "1");
  const pn = String(formData.get("pn") ?? "1");

  const params = new URLSearchParams();
  if (q) params.set("q", q);
  params.set("pz", pz);
  params.set("pn", pn);
  params.set("tab", "audit");

  const result = await mergeNeedsReviewGroupAction(formData);
  if ("error" in result && result.error) {
    params.set("err", result.error);
    redirect(`/admin/duplicates?${params.toString()}`);
  }

  const sr = result as { mergedCount?: number; mergeAuditId?: string };
  params.set("ok", `تمت معالجة السجل بنجاح (${sr.mergedCount ?? 0} سجلات)`);
  if (sr.mergeAuditId) params.set("audit", sr.mergeAuditId);
  redirect(`/admin/duplicates?${params.toString()}`);
}

export async function mergeAuditBatchAction(formData: FormData) {
  const q = String(formData.get("q") ?? "");
  const pz = String(formData.get("pz") ?? "1");
  const pn = String(formData.get("pn") ?? "1");

  const params = new URLSearchParams();
  if (q) params.set("q", q);
  params.set("pz", pz);
  params.set("pn", pn);
  params.set("tab", "audit");

  try {
    const result = await mergeNeedsReviewBatchAction(formData);
    if (result.error) {
      params.set("err", result.error);
      redirect(`/admin/duplicates?${params.toString()}`);
    }

    const processedGroups = result.processedGroups ?? result.mergedGroups ?? 0;
    const mergedGroups = result.mergedGroups ?? 0;
    const mergedRows = result.mergedRows ?? 0;
    const skippedGroups = result.skippedGroups ?? 0;
    const failedGroups = result.failedGroups ?? 0;
    const truncatedCount = result.truncatedCount ?? 0;
    const truncatedSuffix = truncatedCount > 0 ? `، والمتبقي ${truncatedCount} مجموعة للدفعة التالية` : "";
    params.set(
      "ok",
      `تمت معالجة ${processedGroups} مجموعة: نجح ${mergedGroups}، تخطى ${skippedGroups}، فشل ${failedGroups} (${mergedRows} سجلات)${truncatedSuffix}`
    );
  } catch {
    params.set("err", "تعذر معالجة دفعة المراجعة حالياً. أعد المحاولة بدفعة أصغر.");
  }
  redirect(`/admin/duplicates?${params.toString()}`);
}

export async function undoMergeAction(formData: FormData) {
  const q = String(formData.get("q") ?? "");
  const pz = String(formData.get("pz") ?? "1");
  const pn = String(formData.get("pn") ?? "1");

  const params = new URLSearchParams();
  if (q) params.set("q", q);
  params.set("pz", pz);
  params.set("pn", pn);

  const result = await undoMergeDuplicateBeneficiariesByAuditId(formData);
  if (result.error) {
    params.set("err", result.error);
    redirect(`/admin/duplicates?${params.toString()}`);
  }

  params.set("ok", "تم التراجع عن عملية الدمج بنجاح");
  params.set("undone", "1");
  redirect(`/admin/duplicates?${params.toString()}`);
}

export async function ignoreAction(formData: FormData) {
  const res = await ignoreDuplicatePairAction(formData);
  if (res.error) return { error: res.error };
  return { ok: "تم تعليم السجلين كأشخاص مختلفين" };
}
