/**
 * A dependency connection is stored as a formula reference. If the target has
 * no meaningful formula yet, the source becomes the whole formula; otherwise
 * append `+ source` as an editable default. The user can change the operator.
 */
export function appendDependencyFormula(
  existingFormula: string | undefined,
  sourceName: string,
): string {
  const trimmed = (existingFormula ?? '').trim();
  if (!trimmed || trimmed === '0') return sourceName;
  return `${trimmed} + ${sourceName}`;
}
