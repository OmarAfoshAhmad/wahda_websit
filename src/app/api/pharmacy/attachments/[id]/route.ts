import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { hasPermission, requireActiveFacilitySession } from "@/lib/session-guard";
import { assertCompanyAccessForSession } from "@/lib/company-scope";
import { checkRateLimit } from "@/lib/rate-limit";

const STORAGE_ROOT = path.join(process.cwd(), "storage", "pharmacy-prescriptions");

/** يعرض مرفق صرف (بطاقة أو وصفة) لمن يملك صلاحية الصيدلية وضمن نطاق شركة المستفيد فقط. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireActiveFacilitySession();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });
  if (!hasPermission(session, "pharmacy_services") && !hasPermission(session, "view_pharmacy_beneficiaries")) {
    return new NextResponse("Forbidden", { status: 403 });
  }
  const rateLimitError = await checkRateLimit(`api:${session.id}`, "api");
  if (rateLimitError) return NextResponse.json({ error: rateLimitError }, { status: 429 });

  const { id } = await params;
  const attachment = await prisma.pharmacyDispenseAttachment.findUnique({
    where: { id },
    select: {
      file_name: true,
      mime_type: true,
      storage_path: true,
      prescription: { select: { company_id: true } },
      dispense: { select: { company_id: true } },
    },
  });
  const companyId = attachment?.prescription?.company_id ?? attachment?.dispense?.company_id;
  if (!attachment || !companyId) return new NextResponse("Not found", { status: 404 });
  try {
    await assertCompanyAccessForSession(session, companyId);
  } catch {
    return new NextResponse("Forbidden", { status: 403 });
  }

  // المسار المخزن يجب أن يبقى داخل مجلد المرفقات؛ أي مسار خارجه يُرفض.
  const absolutePath = path.resolve(process.cwd(), attachment.storage_path);
  if (!absolutePath.startsWith(STORAGE_ROOT + path.sep)) return new NextResponse("Not found", { status: 404 });

  let bytes: Buffer;
  try {
    bytes = await readFile(absolutePath);
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": attachment.mime_type,
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(attachment.file_name)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
