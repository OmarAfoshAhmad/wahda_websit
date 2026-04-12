import { redirect } from "next/navigation";
import Link from "next/link";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { getLedgerRemainingByBeneficiaryIds } from "@/lib/ledger-balance";
import { Shell } from "@/components/shell";
import { Card, Badge, Input, Button } from "@/components/ui";
import {
  mergeDuplicateGroupByCanonicalAction,
  mergeDuplicateManualSelectionAction,
  mergeDuplicateBatchByConditionAction,
  mergeNeedsReviewGroupAction,
  mergeNeedsReviewBatchAction,
  undoMergeDuplicateBeneficiariesByAuditId,
  ignoreDuplicatePairAction,
  mergeAllGlobalZeroVariantsAction,
} from "@/app/actions/beneficiary";
import { buildDuplicateGroups, paginate } from "@/lib/duplicate-groups";
import { RotateCcw, CheckCircle2, AlertCircle } from "lucide-react";
import { DuplicateManualMergeForm } from "@/components/duplicate-manual-merge-form";
import { DuplicateSameNameGroup } from "@/components/duplicate-same-name-group";
import { BatchMergeButton } from "@/components/batch-merge-button";
import { AutoMergeAllZeroVariantsButton } from "@/components/auto-merge-all-zero-variants-button";

export default async function DuplicatesAdminPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string; pz?: string; pn?: string; pr?: string; ok?: string; err?: string;
    audit?: string; undone?: string; tab?: string;
    merged?: string; before?: string; after?: string;
  }>;
}) {
  async function mergeGroupAction(formData: FormData) {
    "use server";

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

  async function mergeManualAction(formData: FormData) {
    "use server";
    const result = await mergeDuplicateManualSelectionAction(formData);
    if ("error" in result && result.error) return { error: result.error };
    const sr = result as { mergedCount?: number; mergeAuditId?: string };
    return { ok: `تم الدمج المخصص بنجاح (${sr.mergedCount ?? 0} سجلات)` };
  }

  async function mergeAllZeroVariantsUIAction(_formData: FormData) {
    "use server";
    try {
      const res = await mergeAllGlobalZeroVariantsAction();
      if (res.error) {
        redirect(`/admin/duplicates?tab=review&err=${encodeURIComponent(res.error)}`);
      } else {
        const remaining = Number(res.truncatedCount ?? 0);
        const remainingSuffix = remaining > 0 ? `، والمتبقي ${remaining} مجموعة للدفعة التالية` : "";
        let params = `?tab=review&ok=${encodeURIComponent(`تم الدمج الآمن بنجاح (${res.mergedGroups} مجموعات)${remainingSuffix}`)}`;
        if (res.firstAuditId) params += `&audit=${res.firstAuditId}`;
        redirect(`/admin/duplicates${params}`);
      }
    } catch {
      redirect(`/admin/duplicates?tab=review&err=${encodeURIComponent("تعذر تنفيذ الدمج الآمن حالياً. أعد المحاولة، وسيتم التنفيذ على دفعات أصغر تلقائياً.")}`);
    }
  }

  async function mergeBatchAction(formData: FormData) {
    "use server";

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

  async function mergeAuditGroupAction(formData: FormData) {
    "use server";
    const result = await mergeNeedsReviewGroupAction(formData);
    if ("error" in result && result.error) return { error: result.error };
    const sr = result as { mergedCount?: number; mergeAuditId?: string };
    return { ok: `تمت معالجة السجل بنجاح (${sr.mergedCount ?? 0} سجلات)` };
  }

  async function mergeAuditBatchAction(formData: FormData) {
    "use server";

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

  async function undoMergeAction(formData: FormData) {
    "use server";

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

  async function _ignoreAction(formData: FormData) {
    "use server";
    const res = await ignoreDuplicatePairAction(formData);
    if (res.error) return { error: res.error };
    return { ok: "تم تعليم السجلين كأشخاص مختلفين" };
  }

  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.is_admin) redirect("/dashboard");

  const { q, pz, pn, pr, ok, err, audit: _audit, undone: _undone, tab, merged, before, after } = await searchParams;
  const isBatchSuccess = (ok ?? "").startsWith("success_batch");
  const limitedMatch = /^success_batch_limited_(\d+)$/.exec(ok ?? "");
  const limitedRemaining = limitedMatch ? Number(limitedMatch[1]) : 0;
  const activeTab = tab === "merged" || tab === "audit" ? tab : "review";
  const pageZero = Number.parseInt(pz ?? "1", 10) || 1;
  const pageName = Number.parseInt(pn ?? "1", 10) || 1;
  const pageSize = 20;

  // High-performance lean fetch: only fields needed for grouping
  const rows = await prisma.beneficiary.findMany({
    where: {
      deleted_at: null,
      ...(q?.trim() ? {
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { card_number: { contains: q, mode: "insensitive" } }
        ]
      } : {})
    },
    select: {
      id: true,
      name: true,
      card_number: true,
      birth_date: true,
    },
    orderBy: { card_number: "asc" },
  });

  // Fetch ignored pairs
  const ignoreLogs = await prisma.auditLog.findMany({
    where: { action: "IGNORE_DUPLICATE_PAIR" },
    select: { metadata: true },
  });

  const ignoredPairKeys = new Set<string>();
  for (const log of ignoreLogs) {
    const meta = (log.metadata ?? {}) as Record<string, unknown>;
    const ignoreIds = Array.isArray(meta.ignore_ids)
      ? meta.ignore_ids.filter((id): id is string => typeof id === "string")
      : [];
    if (ignoreIds.length > 0) {
      const sortedIds = [...ignoreIds].sort();
      ignoredPairKeys.add(sortedIds.join("-"));
    }
  }

  // Filter rows if they are part of an ignored pair with another row in the same potential group
  // Actually, it's easier to filter the GROUPS after building them, or just exclude them from the grouping initial phase.
  // Let's filter the groups after building them for better precision.

  const groupingRows = rows.map((row) => ({
    ...row,
    status: "ACTIVE",
    total_balance: 0,
    remaining_balance: 0,
  }));

  const { zeroVariantGroups, sameNameGroups: rawSameNameGroups, needsReviewZeroVariants } = buildDuplicateGroups(groupingRows, q);

  const sameNameGroups = rawSameNameGroups.filter(g => {
    if (g.members.length < 2) return true;
    const ids = g.members.map(m => m.id).sort();
    // If any pair in this group is ignored, we might want to hide the group or just those members.
    // Simplifying: if the whole set was marked as different, skip.
    return !ignoredPairKeys.has(ids.join("-"));
  });
  const zeroPage = paginate(zeroVariantGroups, pageZero, pageSize);
  const namePage = paginate(sameNameGroups, pageName, pageSize);
  const reviewPage = paginate(needsReviewZeroVariants, Number.parseInt(pr ?? "1", 10) || 1, pageSize);

  // Fetch full details ONLY for current page items to ensure performance & data accuracy
  const visibleIds = [
    ...zeroPage.items.flatMap(g => g.members.map(m => m.id)),
    ...namePage.items.flatMap(g => g.members.map(m => m.id)),
    ...reviewPage.items.flatMap(g => g.members.map(m => m.id)),
  ];

  const fullDetails = await prisma.beneficiary.findMany({
    where: { id: { in: visibleIds } },
    select: {
      id: true,
      status: true,
    }
  });

  const visibleRemainingById = await getLedgerRemainingByBeneficiaryIds(visibleIds);

  const visibleBaseCards = new Set<string>();
  const allVisibleMembers = [...zeroPage.items.flatMap(g => g.members), ...namePage.items.flatMap(g => g.members), ...reviewPage.items.flatMap(g => g.members)];
  for (const m of allVisibleMembers) {
    const match = m.card_number.match(/^(.*?)([WSDMFHV])(\d+)$/i);
    if (match) visibleBaseCards.add(match[1]);
  }

  const heads = visibleBaseCards.size > 0 ? await prisma.beneficiary.findMany({
    where: { card_number: { in: Array.from(visibleBaseCards) }, deleted_at: null },
    select: { card_number: true, name: true },
  }) : [];
  const headNameMap = new Map(heads.map(h => [h.card_number, h.name]));

  const detailsMap = new Map(fullDetails.map(d => [d.id, d]));
  const enrich = (m: (typeof zeroPage.items)[number]["members"][number]) => {
    let headName = null;
    const match = m.card_number.match(/^(.*?)([WSDMFHV])(\d+)$/i);
    if (match) {
      headName = headNameMap.get(match[1]) ?? match[1];
    } else {
      headName = m.name; // If no match, they are the head
    }
    return {
      ...m,
      head_of_household: headName,
      status: detailsMap.get(m.id)?.status ?? "ACTIVE",
      remaining_balance: visibleRemainingById.get(m.id) ?? 0,
    };
  };

  zeroPage.items.forEach(g => g.members = g.members.map(enrich));
  namePage.items.forEach(g => g.members = g.members.map(enrich));
  reviewPage.items.forEach(g => g.members = g.members.map(enrich));

  const buildHref = (nextPz: number, nextPn: number) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    params.set("pz", String(nextPz));
    params.set("pn", String(nextPn));
    params.set("tab", activeTab);
    return `/admin/duplicates?${params.toString()}`;
  };

  const buildTabHref = (nextTab: "review" | "merged" | "audit") => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    params.set("pz", String(pageZero));
    params.set("pn", String(pageName));
    params.set("tab", nextTab);
    return `/admin/duplicates?${params.toString()}`;
  };

  const exportHref = `/api/admin/duplicates/export${q ? `?q=${encodeURIComponent(q)}` : ""}`;

  const recentMergeLogs = await prisma.auditLog.findMany({
    where: { action: "MERGE_DUPLICATE_BENEFICIARY" },
    select: {
      id: true,
      user: true,
      created_at: true,
      metadata: true,
    },
    orderBy: { created_at: "desc" },
    take: 50,
  });

  const parseEventTime = (value: unknown, fallback: Date) => {
    if (typeof value !== "string") return fallback;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? fallback : d;
  };

  // إظهار سجل واحد فقط لكل حالة (لكل بطاقة معيارية)، وليس تاريخًا كاملاً من السجلات المتراكمة.
  const latestLogByCard = new Map<string, (typeof recentMergeLogs)[number]>();
  for (const log of recentMergeLogs) {
    const m = (log.metadata ?? {}) as Record<string, unknown>;
    const card = String(m.card_number ?? "").trim() || "UNKNOWN";
    const prev = latestLogByCard.get(card);
    if (!prev) {
      latestLogByCard.set(card, log);
      continue;
    }

    const prevMeta = (prev.metadata ?? {}) as Record<string, unknown>;
    const prevEventAt = parseEventTime(prevMeta.undo_reverted_at ?? prevMeta.last_merged_at, prev.created_at);
    const nextEventAt = parseEventTime(m.undo_reverted_at ?? m.last_merged_at, log.created_at);
    if (nextEventAt.getTime() >= prevEventAt.getTime()) {
      latestLogByCard.set(card, log);
    }
  }

  const caseLogs = [...latestLogByCard.values()].sort((a, b) => {
    const am = (a.metadata ?? {}) as Record<string, unknown>;
    const bm = (b.metadata ?? {}) as Record<string, unknown>;
    const aEventAt = parseEventTime(am.undo_reverted_at ?? am.last_merged_at, a.created_at);
    const bEventAt = parseEventTime(bm.undo_reverted_at ?? bm.last_merged_at, b.created_at);
    return bEventAt.getTime() - aEventAt.getTime();
  });

  const mergedIdsFromLogs = [...new Set(
    caseLogs.flatMap((log) => {
      const m = (log.metadata ?? {}) as Record<string, unknown>;
      const snapshot = (m.undo_snapshot ?? null) as Record<string, unknown> | null;
      const mergedBefore = Array.isArray(snapshot?.merged_before) ? snapshot?.merged_before : [];
      return mergedBefore
        .map((row) => {
          if (!row || typeof row !== "object") return "";
          const id = (row as Record<string, unknown>).id;
          return typeof id === "string" ? id : "";
        })
        .filter(Boolean);
    })
  )];

  const keepIdsFromLogs = [...new Set(
    recentMergeLogs
      .map((log) => {
        const m = (log.metadata ?? {}) as Record<string, unknown>;
        return typeof m.keep_beneficiary_id === "string" ? m.keep_beneficiary_id : "";
      })
      .filter(Boolean)
  )];

  const keepNames = keepIdsFromLogs.length > 0
    ? await prisma.beneficiary.findMany({
      where: { id: { in: keepIdsFromLogs } },
      select: { id: true, name: true },
    })
    : [];

  const mergedNames = mergedIdsFromLogs.length > 0
    ? await prisma.beneficiary.findMany({
      where: { id: { in: mergedIdsFromLogs } },
      select: { id: true, name: true },
    })
    : [];

  const keepRemainingById = await getLedgerRemainingByBeneficiaryIds(keepNames.map((row) => row.id));
  const keepInfoById = new Map(
    keepNames.map((r) => [r.id, { name: r.name, remaining_balance: keepRemainingById.get(r.id) ?? 0 }])
  );
  const mergedNameById = new Map(mergedNames.map((r) => [r.id, r.name]));

  return (
    <Shell facilityName={session.name} session={session}>
      <div className="space-y-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="section-title text-2xl font-black text-slate-950 dark:text-white">إدارة التكرارات</h1>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
              استكشاف حالات التكرار ومعالجتها داخل المنظومة. الدمج يعتمد تلقائياً البطاقة التي تحتوي أصفاراً بعد 2025.
            </p>
          </div>
          <div className="w-full sm:w-auto flex flex-col sm:flex-row gap-2 sm:items-center">
            <form className="w-full sm:w-80">
              <Input name="q" defaultValue={q ?? ""} placeholder="بحث بالاسم أو البطاقة أو canonical" autoComplete="off" />
            </form>
            <Link href={exportHref} className="inline-flex">
              <Button type="button" variant="outline" className="h-10 w-full sm:w-auto">تصدير Excel</Button>
            </Link>
          </div>
        </div>

        {(ok || err) && (
          <Card className={`p-4 ${err ? "border-red-200 dark:border-red-900" : "border-emerald-200 dark:border-emerald-900"}`}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                {err ? (
                  <AlertCircle className="h-5 w-5 text-red-600" />
                ) : (
                  <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                )}
                <div>
                  <p className={`text-sm font-bold ${err ? "text-red-700 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400"}`}>
                    {isBatchSuccess ? "تم دمج الدفعة بنجاح" : (err ?? ok)}
                  </p>
                  {isBatchSuccess && (
                    <p className="text-xs text-emerald-700 dark:text-emerald-400 mt-0.5">
                      تم دمج ✨ {merged || "0"} مجموعة. الإحصائيات: {before || "؟"} سجل قبل الدمج ← {after || "؟"} سجل بعد الدمج{limitedRemaining > 0 ? `، والمتبقي ${limitedRemaining} مجموعة` : ""}.
                    </p>
                  )}
                </div>
              </div>
            </div>
          </Card>
        )}

        <Card className="p-2">
          <div className="grid grid-cols-3 gap-2">
            <Link href={buildTabHref("review")}>
              <Button
                type="button"
                variant={activeTab === "review" ? "primary" : "outline"}
                className="w-full h-10"
              >
                حالات جاهزة للدمج
              </Button>
            </Link>
            <Link href={buildTabHref("merged")}>
              <Button
                type="button"
                variant={activeTab === "merged" ? "primary" : "outline"}
                className="w-full h-10"
              >
                حالات مدموجة
              </Button>
            </Link>
            <Link href={buildTabHref("audit")}>
              <Button
                type="button"
                variant={activeTab === "audit" ? "primary" : "outline"}
                className="w-full h-10"
              >
                حالات تحتاج تدقيق
              </Button>
            </Link>
          </div>
        </Card>

        {activeTab === "merged" && (
          <Card className="overflow-hidden">
            <div className="border-b border-slate-200 dark:border-slate-800 px-4 py-3 sm:px-6">
              <h2 className="text-sm font-black text-slate-900 dark:text-white">سجل نتائج الدمج (مع التراجع لكل سجل)</h2>
            </div>
            <div className="space-y-3 p-4 sm:p-6">
              {caseLogs.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">لا يوجد دمج مسجل بعد.</p>
              ) : (
                caseLogs.map((log) => {
                  const m = (log.metadata ?? {}) as Record<string, unknown>;
                  const _mergedIds = Array.isArray(m.merged_beneficiary_ids) ? m.merged_beneficiary_ids : [];
                  const revertedAt = typeof m.undo_reverted_at === "string" ? m.undo_reverted_at : null;
                  const keepNameFromMeta = typeof m.keep_beneficiary_name === "string" ? m.keep_beneficiary_name : "";
                  const keepId = typeof m.keep_beneficiary_id === "string" ? m.keep_beneficiary_id : "";
                  const keepName = keepNameFromMeta || keepInfoById.get(keepId)?.name || "-";
                  const _caseStatusLabel =
                    typeof m.case_status_label === "string"
                      ? m.case_status_label
                      : revertedAt
                        ? "تم التراجع"
                        : "تمت معالجة الدمج واعتمد";
                  const snapshot = (m.undo_snapshot ?? null) as Record<string, unknown> | null;
                  const mergedBefore = Array.isArray(snapshot?.merged_before)
                    ? snapshot!.merged_before
                    : [];
                  const keepBefore =
                    snapshot && typeof snapshot.keep_before === "object" && snapshot.keep_before
                      ? (snapshot.keep_before as Record<string, unknown>)
                      : null;
                  const keepBeforeBalance = keepBefore ? Number(keepBefore.remaining_balance ?? 0) : null;
                  const keepCurrentBalance = keepId ? keepInfoById.get(keepId)?.remaining_balance ?? null : null;
                  const approvedBalanceFromMeta =
                    typeof m.approved_remaining_balance === "number" ? m.approved_remaining_balance : null;
                  const approvedBalance = approvedBalanceFromMeta ?? (revertedAt
                    ? (keepBeforeBalance ?? keepCurrentBalance)
                    : (keepCurrentBalance ?? keepBeforeBalance));
                  const keepCard = typeof m.chosen_keep_card_number === "string" ? m.chosen_keep_card_number : "-";

                  const mergedPeopleDetails = mergedBefore
                    .map((row) => {
                      if (!row || typeof row !== "object") return null;
                      const item = row as Record<string, unknown>;
                      const id = typeof item.id === "string" ? item.id : "";
                      const nameFromSnapshot = typeof item.name === "string" ? item.name : "";
                      const name = nameFromSnapshot || mergedNameById.get(id) || "غير معروف";
                      const card = typeof item.card_number === "string" ? item.card_number : "-";
                      const balance = Number(item.remaining_balance ?? 0);
                      return { id, name, card, balance };
                    })
                    .filter((x): x is { id: string; name: string; card: string; balance: number } => !!x);

                  const statusTone = revertedAt
                    ? "border-amber-300 bg-amber-50/40 dark:border-amber-800 dark:bg-amber-950/20"
                    : "border-emerald-300 bg-emerald-50/40 dark:border-emerald-800 dark:bg-emerald-950/20";
                  return (
                    <div key={log.id} className={`rounded-md border p-3 ${statusTone}`}>
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <Badge variant="success" className="text-base px-3 py-2 min-w-22 justify-center">
                            {approvedBalance == null ? "غير متاح" : `${approvedBalance.toLocaleString("ar-LY")} د.ل`}
                          </Badge>

                          {revertedAt ? (
                            <Badge variant="warning">تم التراجع</Badge>
                          ) : (
                            <form action={undoMergeAction}>
                              <input type="hidden" name="audit_id" value={log.id} />
                              <input type="hidden" name="q" value={q ?? ""} />
                              <input type="hidden" name="pz" value={String(zeroPage.page)} />
                              <input type="hidden" name="pn" value={String(namePage.page)} />
                              <Button type="submit" variant="outline" className="h-9 w-9 p-0" title="تراجع عن هذا الدمج" aria-label="تراجع عن هذا الدمج">
                                <RotateCcw className="h-4 w-4" />
                              </Button>
                            </form>
                          )}
                        </div>

                        <div className="flex items-center gap-2">
                          <p className="text-sm font-bold text-slate-900 dark:text-white">{String(m.card_number ?? "-")}</p>
                          {!revertedAt && <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-label="مدمج" />}
                        </div>
                      </div>

                      <div className="space-y-2 w-full">

                        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                          <div className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-1.5 dark:border-emerald-800 dark:bg-emerald-950/30 flex flex-col justify-between">
                            <p className="text-xs font-black text-emerald-800 dark:text-emerald-300">المعتمد</p>
                            <div className="mt-0.5 flex items-center justify-between gap-2">
                              <p className="text-xs text-emerald-900 dark:text-emerald-200">{keepName} ({keepCard})</p>
                              {keepBeforeBalance != null && (
                                <span className="text-xs font-bold text-emerald-800 dark:text-emerald-300 whitespace-nowrap">{keepBeforeBalance.toLocaleString("ar-LY")} د.ل</span>
                              )}
                            </div>
                          </div>

                          <div className="rounded-md border border-red-300 bg-red-50 px-3 py-1.5 dark:border-red-900 dark:bg-red-950/20 flex flex-col justify-between">
                            <p className="text-xs font-black text-red-800 dark:text-red-300">الملغي</p>
                            {mergedPeopleDetails.length === 0 ? (
                              <p className="text-xs text-red-900 dark:text-red-200">لا توجد بيانات محفوظة</p>
                            ) : (
                              <div className="space-y-0.5">
                                {mergedPeopleDetails.map((p) => (
                                  <div key={p.id || p.card} className="flex items-center justify-between gap-2">
                                    <p className="text-xs text-red-900 dark:text-red-200">{p.name} ({p.card})</p>
                                    <span className="text-xs font-bold text-red-800 dark:text-red-300 whitespace-nowrap">{p.balance.toLocaleString("ar-LY")} د.ل</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </Card>
        )}

        {activeTab === "review" && (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3" suppressHydrationWarning={true}>
              <Card className="p-4">
                <p className="text-sm font-bold text-slate-500 dark:text-slate-400" suppressHydrationWarning={true}>تكرار الأصفار (جاهز للدمج)</p>
                <p className="mt-1 text-2xl font-black text-slate-900 dark:text-white" suppressHydrationWarning={true}>{zeroVariantGroups.length}</p>
              </Card>
              <Card className="p-4">
                <p className="text-sm font-bold text-slate-500 dark:text-slate-400" suppressHydrationWarning={true}>نفس الاسم — تحتاج تدقيق</p>
                <p className="mt-1 text-2xl font-black text-slate-900 dark:text-white" suppressHydrationWarning={true}>{sameNameGroups.length}</p>
              </Card>
              <Card className="p-4">
                <p className="text-sm font-bold text-slate-500 dark:text-slate-400" suppressHydrationWarning={true}>تعارض تاريخ الميلاد (أشخاص مختلفون محتملون)</p>
                <p className="mt-1 text-2xl font-black text-amber-600 dark:text-amber-400" suppressHydrationWarning={true}>
                  {sameNameGroups.filter((g) => g.hasBirthDateConflict).length}
                </p>
              </Card>
            </div>

            <Card className="overflow-hidden">
              <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 px-4 py-3 sm:px-6">
                <h2 className="text-sm font-black text-slate-900 dark:text-white">حالات اختلاف الأصفار (جاهزة للدمج)</h2>
                {zeroVariantGroups.length > 0 && (
                  <AutoMergeAllZeroVariantsButton />
                )}
              </div>
              <div className="space-y-4 p-4 sm:p-6">
                {zeroPage.items.length > 0 && (
                  <form action={mergeBatchAction} className="rounded-md border border-slate-200 dark:border-slate-700 p-3">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <p className="text-xs text-slate-600 dark:text-slate-400">دمج دفعة الصفحة الحالية حسب شرط موحد</p>
                      <div className="flex items-center gap-2">
                        <select name="strategy" defaultValue="ZERO_PRIORITY" className="h-9 rounded-md border border-slate-300 bg-white px-2 text-xs dark:border-slate-700 dark:bg-slate-900">
                          <option value="ZERO_PRIORITY">أولوية البطاقة ذات الأصفار</option>
                          <option value="LOWEST_BALANCE">أقل رصيد</option>
                          <option value="HIGHEST_TRANSACTIONS">أعلى عدد معاملات</option>
                        </select>
                        <input type="hidden" name="q" value={q ?? ""} />
                        <input type="hidden" name="pz" value={String(zeroPage.page)} />
                        <input type="hidden" name="pn" value={String(namePage.page)} />
                        {zeroPage.items.map((g) => (
                          <input
                            key={`batch-${g.canonical}`}
                            type="hidden"
                            name="group_payload"
                            value={JSON.stringify({
                              keepId: g.preferredId,
                              memberIds: g.members.map(m => m.id)
                            })}
                          />
                        ))}
                        <BatchMergeButton label="دمج دفعة" />
                      </div>
                    </div>
                  </form>
                )}

                {zeroVariantGroups.length === 0 ? (
                  <p className="text-sm text-slate-500 dark:text-slate-400">لا توجد حالات مطابقة.</p>
                ) : (
                  zeroPage.items.map((group) => (
                    <div key={group.canonical} className="rounded-md border border-slate-200 dark:border-slate-700 p-3">
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <Badge variant="warning">{group.members.length} سجلات</Badge>
                          <span className="text-sm font-bold text-slate-800 dark:text-slate-200">{group.canonical}</span>
                        </div>
                        <form action={mergeGroupAction}>
                          <input type="hidden" name="canonical_card" value={group.canonical} />
                          <input type="hidden" name="strategy" value="ZERO_PRIORITY" />
                          <input type="hidden" name="q" value={q ?? ""} />
                          <input type="hidden" name="pz" value={String(zeroPage.page)} />
                          <input type="hidden" name="pn" value={String(namePage.page)} />
                          <input type="hidden" name="tab" value="review" />
                          <Button type="submit" className="h-8 text-xs">دمج المجموعة</Button>
                        </form>
                      </div>

                      <DuplicateManualMergeForm
                        members={group.members.map((m) => ({
                          id: m.id,
                          name: m.name,
                          card_number: m.card_number,
                          birth_date: m.birth_date,
                          head_of_household: (m as { head_of_household?: string | null }).head_of_household,
                          total_balance: Number(m.total_balance ?? 0),
                          remaining_balance: Number(m.remaining_balance),
                          status: m.status,
                          transactionsCount: m._count?.transactions ?? 0,
                        }))}
                        preferredId={group.preferredId}
                        q={q ?? ""}
                        pz={zeroPage.page}
                        pn={namePage.page}
                        helperText="اختر سجلًا واحدًا للإبقاء، والباقي حذف ناعم تلقائي"
                        action={mergeManualAction}
                      />
                    </div>
                  ))
                )}
                {zeroVariantGroups.length > 0 && (
                  <div className="flex items-center justify-between pt-1">
                    <p className="text-xs text-slate-500 dark:text-slate-400">صفحة {zeroPage.page} من {zeroPage.pages} • {zeroPage.total} مجموعة</p>
                    <div className="flex items-center gap-2">
                      <Link href={buildHref(Math.max(1, zeroPage.page - 1), namePage.page)}>
                        <Button type="button" variant="outline" className="h-8 px-3 text-xs" disabled={zeroPage.page <= 1}>السابق</Button>
                      </Link>
                      <Link href={buildHref(Math.min(zeroPage.pages, zeroPage.page + 1), namePage.page)}>
                        <Button type="button" variant="outline" className="h-8 px-3 text-xs" disabled={zeroPage.page >= zeroPage.pages}>التالي</Button>
                      </Link>
                    </div>
                  </div>
                )}
              </div>
            </Card>

          </>
        )}

        {activeTab === "audit" && (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Card className="p-4">
                <p className="text-sm font-bold text-slate-500 dark:text-slate-400">تكرار أصفار بأسماء مختلفة</p>
                <p className="mt-1 text-2xl font-black text-amber-600 dark:text-amber-400">{needsReviewZeroVariants.length}</p>
              </Card>
              <Card className="p-4">
                <p className="text-sm font-bold text-slate-500 dark:text-slate-400">نفس الاسم ببطاقات متعددة</p>
                <p className="mt-1 text-2xl font-black text-slate-900 dark:text-white">{sameNameGroups.length}</p>
              </Card>
              <Card className="p-4">
                <p className="text-sm font-bold text-slate-500 dark:text-slate-400">تعارض تاريخ الميلاد</p>
                <p className="mt-1 text-2xl font-black text-red-600 dark:text-red-400">
                  {sameNameGroups.filter((g) => g.hasBirthDateConflict).length}
                </p>
              </Card>
            </div>

            <Card className="p-4">
              <p className="text-sm font-black text-slate-900 dark:text-white">كيفية معالجة هذه الحالات</p>
              <p className="mt-2 text-xs text-slate-600 dark:text-slate-400">
                هذه الحالات ليست دمجًا تلقائيًا. راجع كل بطاقة يدويًا:
                1) تأكد أن السجلين لنفس الشخص فعلاً.
                2) افتح المستفيدين ووحّد الاسم/البيانات أولًا إن لزم.
                3) بعد تصحيح البيانات ستنتقل الحالة تلقائيًا إلى تبويب الحالات الجاهزة للدمج.
              </p>
            </Card>

            {/* ── تكرار أصفار بأسماء مختلفة ────────────────────── */}
            <Card className="overflow-hidden">
              <div className="border-b border-slate-200 dark:border-slate-800 px-4 py-3 sm:px-6">
                <h2 className="text-sm font-black text-amber-700 dark:text-amber-400">تكرار أصفار بأسماء مختلفة (يحتاج تدقيق)</h2>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  يوجد أرقام بطاقات متطابقة canonically (اختلاف أصفار بعد WAB2025) لكن الأسماء مختلفة. راجع يدويًا إن كانا نفس الشخص أم لا.
                </p>
              </div>
              <div className="space-y-3 p-4 sm:p-6">
                {needsReviewZeroVariants.length === 0 ? (
                  <p className="text-sm text-slate-500 dark:text-slate-400">لا توجد حالات مطابقة.</p>
                ) : (
                  reviewPage.items.map((group) => (
                    <div key={group.canonical} className="rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50/30 dark:bg-amber-950/10 p-3">
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <Badge variant="warning">{group.members.length} سجلات — أسماء مختلفة</Badge>
                          <span className="text-sm font-bold text-slate-800 dark:text-slate-200">{group.canonical}</span>
                        </div>
                      </div>

                      <DuplicateManualMergeForm
                        members={group.members.map((m) => ({
                          id: m.id,
                          name: m.name,
                          card_number: m.card_number,
                          birth_date: m.birth_date,
                          head_of_household: (m as { head_of_household?: string | null }).head_of_household,
                          total_balance: Number(m.total_balance ?? 0),
                          remaining_balance: Number(m.remaining_balance),
                          status: m.status,
                          transactionsCount: m._count?.transactions ?? 0,
                        }))}
                        preferredId={group.preferredId}
                        q={q ?? ""}
                        pz={reviewPage.page}
                        pn={namePage.page}
                        helperText="الأسماء مختلفة — تأكد أنهما نفس الشخص قبل الدمج"
                        action={mergeAuditGroupAction}
                        formId={`review-${group.canonical}`}
                      />
                    </div>
                  ))
                )}
                {needsReviewZeroVariants.length > 0 && (
                  <div className="flex items-center justify-between pt-1">
                    <p className="text-xs text-slate-500 dark:text-slate-400">صفحة {reviewPage.page} من {reviewPage.pages} • {reviewPage.total} مجموعة</p>
                  </div>
                )}
              </div>
            </Card>

            {/* ── نفس الاسم ببطاقات متعددة ────────────────────── */}
            {namePage.items.length > 0 && (
              <form action={mergeAuditBatchAction} className="rounded-md border border-slate-200 dark:border-slate-700 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs text-slate-600 dark:text-slate-400">معالجة دفعة: سيتم اعتماد السجل الافتراضي في كل مجموعة</p>
                  <div className="flex items-center gap-2">
                    <input type="hidden" name="q" value={q ?? ""} />
                    <input type="hidden" name="pz" value={String(namePage.page)} />
                    <input type="hidden" name="pn" value={String(namePage.page)} />
                    {namePage.items.map((g) => (
                      <input
                        key={`audit-payload-${g.nameKey}`}
                        type="hidden"
                        name="group_payload"
                        value={JSON.stringify({ keepId: g.preferredId, memberIds: g.members.map((m) => m.id) })}
                      />
                    ))}
                    <Button type="submit" className="h-9 text-xs">معالجة دفعة</Button>
                  </div>
                </div>
              </form>
            )}

            <Card className="overflow-hidden">
              <div className="border-b border-slate-200 dark:border-slate-800 px-4 py-3 sm:px-6">
                <h2 className="text-sm font-black text-slate-900 dark:text-white">نفس الاسم ببطاقات متعددة (للمراجعة)</h2>
              </div>
              <div className="space-y-3 p-4 sm:p-6">
                {sameNameGroups.length === 0 ? (
                  <p className="text-sm text-slate-500 dark:text-slate-400">لا توجد حالات مطابقة.</p>
                ) : (
                  namePage.items.map((g) => (
                    <DuplicateSameNameGroup
                      key={g.nameKey}
                      nameKey={g.nameKey}
                      name={g.members[0].name}
                      membersCount={g.members.length}
                      hasBirthDateConflict={g.hasBirthDateConflict}

                      memberIds={g.members.map(m => m.id)}
                    >
                      <DuplicateManualMergeForm
                        members={g.members.map((m) => ({
                          id: m.id,
                          name: m.name,
                          card_number: m.card_number,
                          birth_date: m.birth_date,
                          head_of_household: (m as { head_of_household?: string | null }).head_of_household,
                          total_balance: Number(m.total_balance ?? 0),
                          remaining_balance: Number(m.remaining_balance),
                          status: m.status,
                          transactionsCount: m._count?.transactions ?? 0,
                        }))}
                        preferredId={g.preferredId}
                        q={q ?? ""}
                        pz={namePage.page}
                        pn={namePage.page}
                        helperText="افتراضيًا يتم اختيار البطاقة ذات الشكل الصحيح؛ يمكنك تغيير الإبقاء يدويًا"
                        hasBirthDateConflict={g.hasBirthDateConflict}
                        action={mergeAuditGroupAction}
                        formId={`form-${g.members[0].id}`}
                      />
                    </DuplicateSameNameGroup>
                  ))
                )}
                {sameNameGroups.length > 0 && (
                  <div className="flex items-center justify-between pt-1">
                    <p className="text-xs text-slate-500 dark:text-slate-400">صفحة {namePage.page} من {namePage.pages} • {namePage.total} مجموعة</p>
                    <div className="flex items-center gap-2">
                      <Link href={buildHref(zeroPage.page, Math.max(1, namePage.page - 1))}>
                        <Button type="button" variant="outline" className="h-8 px-3 text-xs" disabled={namePage.page <= 1}>السابق</Button>
                      </Link>
                      <Link href={buildHref(zeroPage.page, Math.min(namePage.pages, namePage.page + 1))}>
                        <Button type="button" variant="outline" className="h-8 px-3 text-xs" disabled={namePage.page >= namePage.pages}>التالي</Button>
                      </Link>
                    </div>
                  </div>
                )}
              </div>
            </Card>
          </>
        )}
      </div>
    </Shell>
  );
}
