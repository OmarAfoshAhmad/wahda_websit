const currencyFormatter = new Intl.NumberFormat("ar-LY", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function roundCurrency(value: number): number {
  if (!Number.isFinite(value)) return 0;
  // استخدام التدوين العلمي لضمان دقة التقريب لخانين عشريتين (مثل 1.005)
  return Number(Math.round(Number(value + "e2")) + "e-2");
}

export function formatCurrency(value: number): string {
  return currencyFormatter.format(roundCurrency(value));
}