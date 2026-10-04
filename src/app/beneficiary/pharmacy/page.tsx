import { redirect } from "next/navigation";
import { getBeneficiarySession } from "@/lib/beneficiary-auth";
import { getBeneficiaryOrderContext, listMyPharmacyOrders } from "@/app/actions/pharmacy-orders";
import { PharmacyOrderClient } from "./pharmacy-order-client";

export default async function BeneficiaryPharmacyPage() {
  const session = await getBeneficiarySession();
  if (!session) redirect("/beneficiary/login");
  const [context, orders] = await Promise.all([getBeneficiaryOrderContext(), listMyPharmacyOrders()]);
  return (
    <PharmacyOrderClient
      categories={"categories" in context ? context.categories ?? [] : []}
      chronicDrugs={"chronicDrugs" in context ? context.chronicDrugs ?? [] : []}
      contextError={"error" in context ? context.error ?? null : null}
      orders={orders.items}
    />
  );
}
