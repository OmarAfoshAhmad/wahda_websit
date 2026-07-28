import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSessionWithFreshPermissions } from "@/lib/session-guard";
import type { Prisma } from "@prisma/client";

export async function GET() {
  if (process.env.ENABLE_DEBUG_DENTAL !== "true") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  try {
    const session = await getSessionWithFreshPermissions();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (session.role_v2 !== "SUPER_ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const isFacility = session.role === "FACILITY" || (!session.is_admin && !session.is_manager && !session.is_employee);
    const transactionFilter: Prisma.TransactionWhereInput = { is_cancelled: false, service_category: "DENTAL" };
    if (isFacility) {
      transactionFilter.facility_id = session.id;
    }

    const companies = await prisma.insuranceCompany.findMany({
      where: { deleted_at: null, is_active: true },
      orderBy: { name: "asc" },
      include: {
        _count: {
          select: {
            beneficiaries: {
              where: { deleted_at: null, status: "ACTIVE" },
            },
            transactions: {
              where: transactionFilter,
            },
          },
        },
      },
    });

    return NextResponse.json({
      success: true,
      isFacility,
      transactionFilter,
      companiesCount: companies.length,
      sampleCompanyId: companies[0]?.id ?? null,
    });
  } catch (error: unknown) {
    console.error("DEBUG API ERROR", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
