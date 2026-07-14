import { NextResponse } from "next/server";
import { beneficiaryLogout } from "@/lib/beneficiary-auth";

export async function POST() {
  await beneficiaryLogout();
  return NextResponse.json({ ok: true });
}
