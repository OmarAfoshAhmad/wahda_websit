import { notFound, redirect } from "next/navigation";
import { getBeneficiarySession } from "@/lib/beneficiary-auth";
import { getMyPharmacyOrder } from "@/app/actions/pharmacy-orders";
import { BeneficiaryOrderThread } from "./order-thread";

export default async function BeneficiaryOrderPage({ params }: { params: Promise<{ orderId: string }> }) {
  const session = await getBeneficiarySession();
  if (!session) redirect("/beneficiary/login");
  const { orderId } = await params;
  const result = await getMyPharmacyOrder(orderId);
  if (!("order" in result) || !result.order) notFound();
  return <BeneficiaryOrderThread initial={result.order} />;
}
