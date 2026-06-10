import { redirect } from "next/navigation";
import { getSessionWithFreshPermissions, hasPermission } from "@/lib/session-guard";
import { Shell } from "@/components/shell";
import { getServicePolicies } from "@/app/actions/service-policies";
import { ServicePoliciesClient } from "./service-policies-client";

export default async function ServicePoliciesPage() {
  const session = await getSessionWithFreshPermissions();
  if (!session) redirect("/login");
  
  if (!session.is_admin && !hasPermission(session, "manage_companies")) {
    redirect("/dashboard");
  }

  const { policies, serviceTypes, companies, error } = await getServicePolicies();

  if (error || !policies || !serviceTypes || !companies) {
    return (
      <Shell facilityName={session.name} session={session}>
        <div className="p-8 text-center text-red-500 font-bold">
          {error || "حدث خطأ أثناء تحميل البيانات"}
        </div>
      </Shell>
    );
  }

  return (
    <Shell facilityName={session.name} session={session}>
      <ServicePoliciesClient
        initialPolicies={policies}
        serviceTypes={serviceTypes}
        companies={companies}
      />
    </Shell>
  );
}
