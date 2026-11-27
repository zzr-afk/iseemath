export function formatNumber(value: number | undefined, precision?: number): string {
  if (value === undefined || !Number.isFinite(value)) return '—';
  if (precision !== undefined) return value.toFixed(precision);
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
}
