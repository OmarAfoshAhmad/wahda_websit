const currencyFormatter = new Intl.NumberFormat("ar-LY", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function roundCurrency(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function formatCurrency(value: number): string {
  return currencyFormatter.format(roundCurrency(value));
}