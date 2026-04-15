import { TablePageSkeleton } from "@/components/page-skeleton";

export default function TransactionsLoading() {
  return (
    <TablePageSkeleton filterFields={5} tableRows={10} tableCols={6} />
  );
}


