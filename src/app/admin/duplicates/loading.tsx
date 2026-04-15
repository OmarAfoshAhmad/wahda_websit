import { TablePageSkeleton } from "@/components/page-skeleton";

export default function DuplicatesLoading() {
  return (
    <TablePageSkeleton filterFields={2} tableRows={8} tableCols={4} />
  );
}
