import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getBeneficiarySessionFromRequest } from "@/lib/beneficiary-auth";
import { hasPermission, requireActiveFacilitySession } from "@/lib/session-guard";

const STORAGE_ROOT = path.join(/* turbopackIgnore: true */ process.cwd(), "storage", "pharmacy-prescriptions");

/** صورة مرسلة في محادثة طلب صيدلية: يراها المستفيد صاحب الطلب أو حساب المرفق المستقبل له فقط. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ messageId: string }> }) {
  const { messageId } = await params;
  const message = await prisma.pharmacyOrderMessage.findUnique({
    where: { id: messageId },
    select: { file_name: true, mime_type: true, storage_path: true, order: { select: { beneficiary_id: true, facility_id: true } } },
  });
  if (!message?.storage_path) return new NextResponse("Not found", { status: 404 });

  const beneficiary = await getBeneficiarySessionFromRequest(req);
  let allowed = beneficiary?.id === message.order.beneficiary_id;
  if (!allowed) {
    const facility = await requireActiveFacilitySession();
    allowed = Boolean(facility && hasPermission(facility, "pharmacy_services") && facility.id === message.order.facility_id);
  }
  if (!allowed) return new NextResponse("Forbidden", { status: 403 });

  const absolutePath = path.resolve(/* turbopackIgnore: true */ process.cwd(), message.storage_path);
  if (!absolutePath.startsWith(STORAGE_ROOT + path.sep)) return new NextResponse("Not found", { status: 404 });
  let bytes: Buffer;
  try {
    bytes = await readFile(absolutePath);
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": message.mime_type ?? "application/octet-stream",
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(message.file_name ?? "file")}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
