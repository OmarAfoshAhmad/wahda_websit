import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { generateNotFoundWorkbook, type NotFoundRow } from "@/lib/import-transactions";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
  }
  if (!session.is_admin) {
    return NextResponse.json({ error: "ممنوع — المشرفون فقط" }, { status: 403 });
  }

  try {
    const body = await request.json() as { rows?: NotFoundRow[] };

    if (!Array.isArray(body.rows) || body.rows.length === 0) {
      return NextResponse.json({ error: "لا توجد بيانات لتصديرها." }, { status: 400 });
    }

    // Validate row structure to prevent injection
    const safeRows: NotFoundRow[] = body.rows.map((r) => ({
      rowNumber: Number(r.rowNumber) || 0,
      cardNumber: String(r.cardNumber ?? "").slice(0, 50),
      name: String(r.name ?? "").slice(0, 200),
      familyCount: Number(r.familyCount) || 0,
      totalBalance: Number(r.totalBalance) || 0,
      usedBalance: Number(r.usedBalance) || 0,
    }));

    const buffer = await generateNotFoundWorkbook(safeRows);

    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="not-found-${Date.now()}.xlsx"`,
      },
    });
  } catch {
    return NextResponse.json({ error: "فشل إنشاء التقرير." }, { status: 500 });
  }
}
