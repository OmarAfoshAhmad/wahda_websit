import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSessionWithFreshPermissions } from "@/lib/session-guard";

export async function GET(req: NextRequest) {
  try {
    const session = await getSessionWithFreshPermissions();
    if (!session) return NextResponse.json({ error: "No session" });

    const isFacility = session.role === "FACILITY" || (!session.is_admin && !session.is_manager && !session.is_employee);
    const transactionFilter: any = { is_cancelled: false, service_category: "DENTAL" };
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
      sampleCompany: companies[0] || null,
      session_keys: Object.keys(session),
      session_role: session.role,
    });
  } catch (error: any) {
    console.error("DEBUG API ERROR:", error);
    return NextResponse.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
}
