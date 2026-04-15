import { TablePageSkeleton } from "@/components/page-skeleton";

export default function DbAnomaliesLoading() {
  return (
    <TablePageSkeleton filterFields={2} tableRows={8} tableCols={5} />
  );
}
