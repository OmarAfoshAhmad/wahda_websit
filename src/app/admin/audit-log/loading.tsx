import { TablePageSkeleton } from "@/components/page-skeleton";

export default function AuditLogLoading() {
  return (
    <TablePageSkeleton filterFields={3} tableRows={10} tableCols={5} />
  );
}
