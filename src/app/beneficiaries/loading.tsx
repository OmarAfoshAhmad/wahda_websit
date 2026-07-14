import { TablePageSkeleton } from "@/components/page-skeleton";

export default function BeneficiariesLoading() {
  return (
    <TablePageSkeleton statCards={4} filterFields={4} tableRows={10} tableCols={6} />
  );
}

