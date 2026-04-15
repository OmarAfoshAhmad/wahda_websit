import { TablePageSkeleton } from "@/components/page-skeleton";

export default function FacilitiesLoading() {
  return (
    <TablePageSkeleton filterFields={2} tableRows={10} tableCols={5} />
  );
}
