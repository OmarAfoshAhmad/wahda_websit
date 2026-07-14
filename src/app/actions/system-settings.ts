"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { getSession } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { updateInitialBalanceSchema } from "@/lib/validation";

export async function updateInitialBalance(prevState: unknown, formData: FormData) {
  const session = await getSession();
  if (!session || !session.is_admin) {
    return { error: "غير مصرح بهذه العملية" };
  }

  const parsed = updateInitialBalanceSchema.safeParse({
    initialBalance: formData.get("initialBalance"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const value = parsed.data.initialBalance;

  await prisma.auditLog.create({
    data: {
      facility_id: session.id,
      user: session.username,
      action: "SET_INITIAL_BALANCE",
      metadata: {
        value,
        effective_from: new Date().toISOString(),
      },
    },
  });

  revalidatePath("/settings");
  revalidatePath("/beneficiaries");
  revalidateTag("beneficiary-counts", "max");
  revalidatePath("/import");

  return { success: `تم تحديث الرصيد الابتدائي إلى ${value} د.ل`, value };
}
