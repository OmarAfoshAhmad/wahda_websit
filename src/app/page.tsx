import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";

export default async function Home() {
  const session = await getSession();
  
  if (session) {
    if (process.env.NEXT_PUBLIC_APP_MODE === "DENTAL") {
      redirect("/admin/dental-services");
    } else {
      redirect(session.is_employee ? "/cash-claim" : "/dashboard");
    }
  } else {
    redirect("/login");
  }
}
