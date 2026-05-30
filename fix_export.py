import sys

content = open('src/app/api/export/transactions/route.ts', 'r', encoding='utf-8').read()

# Chunk 1
old_chunk1 = '''  const sort = searchParams.get("sort") ?? "created_at";
  const order = searchParams.get("order") === "asc" ? "asc" : "desc";
  const source = searchParams.get("source") ?? "all";'''

new_chunk1 = '''  const sort = searchParams.get("sort") ?? "created_at";
  const order = searchParams.get("order") === "asc" ? "asc" : "desc";
  const source = searchParams.get("source") ?? "all";
  const statusFilter = searchParams.get("status") ?? "active";
  const txTypeFilter = searchParams.get("tx_type") ?? "all";
  const companyFilterId = (searchParams.get("company_id") ?? "").trim();'''

content = content.replace(old_chunk1, new_chunk1)

# Chunk 2
old_chunk2 = '''  // في التقرير: نظهر الحركات العادية المنفذة فقط ونستبعد الملغاة وحركة التصحيح.
  where.type = { not: "CANCELLATION" };
  where.is_cancelled = false;
  if (session.is_employee) {
    // الموظف: تصدير حركات الكاش فقط (المولدة من مسار cash-claim).
    where.idempotency_key = { startsWith: "cash-claim:" };
  }

  if (session.is_admin && source === "import") {
    where.type = "IMPORT";
  } else if (session.is_admin && source === "manual") {
    where.type = { in: ["MEDICINE", "SUPPLIES"] };
  }'''

new_chunk2 = '''  if (session.is_employee) {
    // الموظف: يرى فقط حركات الكاش التي نفذها حسابه، بدون الملغاة أو حركات التصحيح.
    where.type = { notIn: ["CANCELLATION", "SETTLEMENT"] };
    where.is_cancelled = false;
    where.idempotency_key = { startsWith: "cash-claim:" };
  } else {
    // بناءً على حالة statusFilter
    if (statusFilter === "active") {
      where.is_cancelled = false;
    } else if (statusFilter === "deleted") {
      where.is_cancelled = true;
    }
  }

  const canViewSettlement = session.is_admin || session.is_manager;
  if (!canViewSettlement) {
    const existingAnd = Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : [];
    where.AND = [...existingAnd, { type: { not: "SETTLEMENT" } }];
  }

  // المصدر (يدوي / استيراد)
  if (session.is_admin && source === "import") {
    if (where.type) {
      where.AND = [...(Array.isArray(where.AND) ? where.AND : []), { type: "IMPORT" }];
    } else {
      where.type = "IMPORT";
    }
  } else if (session.is_admin && source === "manual") {
    if (!where.type) {
      where.type = { in: ["MEDICINE", "SUPPLIES", "SETTLEMENT"] };
    }
  }'''

content = content.replace(old_chunk2, new_chunk2)

# Chunk 3
old_chunk3 = '''  const existingAndBase = Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : [];
  where.AND = [
    ...existingAndBase,
    { type: { not: "DENTAL" } },
    {
      OR: [
        { company_id: "cmp7ha2km0000u9v8jse4ib5x" },
        { company_id: null }
      ]
    }
  ];'''

new_chunk3 = '''  const existingAndBase = Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : [];
  where.AND = [
    ...existingAndBase,
    { type: { not: "DENTAL" } },
    {
      OR: [
        { company_id: "cmp7ha2km0000u9v8jse4ib5x" },
        { company_id: null }
      ]
    }
  ];

  if (txTypeFilter === "supplies") {
    where.AND.push({ type: "SUPPLIES" });
  } else if (txTypeFilter === "medicine") {
    where.AND.push({ type: { in: ["MEDICINE", "IMPORT"] } });
  }

  if (companyFilterId) {
    where.AND.push({ company_id: companyFilterId });
  }'''

content = content.replace(old_chunk3, new_chunk3)

# Chunk 4
old_chunk4 = '''  // نفس السلوك في صفحة الحركات: آخر 30 يوم افتراضيا عند غياب التاريخ.
  const hasDateFilter = !!(start_date || end_date);
  where.created_at = {};
  if (start_date) {
    const start = getStartOfDayTripoli(start_date);
    if (!isNaN(start.getTime())) {
      where.created_at.gte = start;
    }
  } else if (!hasDateFilter) {
    const nowTripoli = new Date(new Date().toLocaleString("en-US", { timeZone: "Africa/Tripoli" }));
    nowTripoli.setDate(nowTripoli.getDate() - 30);
    nowTripoli.setHours(0, 0, 0, 0);
    const dateStr = nowTripoli.toISOString().split('T')[0];
    where.created_at.gte = getStartOfDayTripoli(dateStr);
  }
  if (end_date) {
    const end = getEndOfDayTripoli(end_date);
    if (!isNaN(end.getTime())) {
      where.created_at.lte = end;
    }
  }'''

new_chunk4 = '''  // فلترة بالتاريخ (نفس منطق صفحة الحركات)
  const hasDateFilter = !!(start_date || end_date);
  if (hasDateFilter) {
    where.created_at = {};
    if (start_date) {
      const start = getStartOfDayTripoli(start_date);
      if (!isNaN(start.getTime())) {
        where.created_at.gte = start;
      }
    }
    if (end_date) {
      const end = getEndOfDayTripoli(end_date);
      if (!isNaN(end.getTime())) {
        where.created_at.lte = end;
      }
    }
    if (Object.keys(where.created_at).length === 0) {
      delete where.created_at;
    }
  }'''

content = content.replace(old_chunk4, new_chunk4)

open('src/app/api/export/transactions/route.ts', 'w', encoding='utf-8').write(content)
print("Done")
