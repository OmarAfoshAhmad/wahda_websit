import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";

export default async function Home() {
  const session = await getSession();
  
  if (session) {
    const appMode = process.env.NEXT_PUBLIC_APP_MODE?.replace(/["']/g, '').toUpperCase() || "";
    if (appMode.includes("DENTAL")) {
      redirect("/admin/dental-services");
    } else {
      redirect(session.is_employee ? "/cash-claim" : "/dashboard");
    }
  } else {
    redirect("/login");
  }
}
