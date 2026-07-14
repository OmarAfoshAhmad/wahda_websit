import { redirect } from "next/navigation";

export default async function BalanceHealthPage() {
  redirect("/admin/db-anomalies");
}
