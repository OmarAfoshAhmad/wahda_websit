import { TablePageSkeleton } from "@/components/page-skeleton";

export default function ManagersLoading() {
  return (
    <TablePageSkeleton filterFields={1} tableRows={8} tableCols={4} />
  );
}
