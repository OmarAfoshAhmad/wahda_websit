import { NextResponse } from "next/server";
import { listCompaniesForLogin } from "@/lib/beneficiary-employee-number";

export const dynamic = "force-dynamic";

/** الشركات المتاحة لدخول المستفيدين (الاسم والشعار وبادئة البطاقة فقط). */
export async function GET() {
  const companies = await listCompaniesForLogin();
  return NextResponse.json({ companies }, { headers: { "Cache-Control": "public, max-age=300" } });
}
