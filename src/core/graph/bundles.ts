import type { Bundle, NodeId } from '@/core/model/types';

export interface BundleSummary {
  mode: Bundle['summary']['mode'];
  value?: number;
  text: string;
  errorCount: number;
  memberValues: number[];
}

function finiteValues(bundle: Bundle, values: Record<NodeId, number | undefined>): number[] {
  const result: number[] = [];
  for (const memberId of bundle.memberIds) {
    const value = values[memberId];
    if (typeof value === 'number' && Number.isFinite(value)) result.push(value);
  }
  return result;
}

export function summarizeBundle(
  bundle: Bundle,
  values: Record<NodeId, number | undefined>,
  errors: Record<NodeId, string | undefined>,
): BundleSummary {
  const errorCount = bundle.memberIds.filter((memberId) => Boolean(errors[memberId])).length;
  const mode = bundle.summary.mode;
  const memberValues = finiteValues(bundle, values);

  if (mode === 'none') {
    return { mode, text: `${bundle.memberIds.length} 项`, errorCount, memberValues };
  }

  if (mode === 'member') {
    const memberId = bundle.summary.memberId;
    const value = memberId ? values[memberId] : undefined;
    const error = memberId ? errors[memberId] : undefined;
    if (error) return { mode, text: '—', errorCount, memberValues };
    return {
      mode,
      value,
      text: typeof value === 'number' ? formatBundleValue(value) : '—',
      errorCount,
      memberValues,
    };
  }

  if (errorCount > 0 || memberValues.length !== bundle.memberIds.length) {
    return { mode, text: '—', errorCount, memberValues };
  }
  if (memberValues.length === 0) return { mode, text: '—', errorCount, memberValues };

  let value: number;
  switch (mode) {
    case 'sum':
      value = memberValues.reduce((sum, item) => sum + item, 0);
      break;
    case 'product':
      value = memberValues.reduce((product, item) => product * item, 1);
      break;
    case 'avg':
      value = memberValues.reduce((sum, item) => sum + item, 0) / memberValues.length;
      break;
    case 'min':
      value = Math.min(...memberValues);
      break;
    case 'max':
      value = Math.max(...memberValues);
      break;
    default:
      value = 0;
  }
  return { mode, value, text: formatBundleValue(value), errorCount, memberValues };
}

export function formatBundleValue(value: number): string {
  if (!Number.isFinite(value)) return '—';
  if (Number.isInteger(value)) return String(value);
  const magnitude = Math.abs(value);
  if (magnitude !== 0 && (magnitude < 0.001 || magnitude >= 1_000_000)) {
    return value.toExponential(3);
  }
  return value.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
}
