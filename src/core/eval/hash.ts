import type { AnyNode, Project, VariableNode } from '@/core/model/types';
import { isCollectionNode } from '@/core/model/types';

/**
 * Deterministic 64-bit-ish hash (two FNV-1a 32-bit lanes) rendered as hex.
 * Not cryptographic; used only for cache keys and change detection.
 */
export function hashString(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    h1 ^= code;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= code + i;
    h2 = Math.imul(h2, 0x85ebca6b);
  }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number') {
      if (Number.isNaN(value)) return 'NaN';
      if (value === Infinity) return 'Infinity';
      if (value === -Infinity) return '-Infinity';
      if (Object.is(value, -0)) return '0';
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const parts: string[] = [];
  for (const key of keys) {
    const item = record[key];
    if (item === undefined) continue;
    parts.push(`${JSON.stringify(key)}:${stableStringify(item)}`);
  }
  return `{${parts.join(',')}}`;
}

export const EVAL_VERSION = '2';

function variableFingerprint(node: VariableNode): unknown {
  return {
    id: node.id,
    kind: node.kind,
    variableKind: node.variableKind,
    role: node.role,
    value: node.variableKind === 'constant' ? node.value : undefined,
    formula: node.variableKind === 'formula' ? node.formula : undefined,
    curve: node.variableKind === 'curve' ? node.curve : undefined,
    table: node.variableKind === 'table' ? node.table : undefined,
  };
}

function nodeFingerprint(node: AnyNode): unknown {
  if (node.kind === 'variable') return variableFingerprint(node);
  if (isCollectionNode(node)) {
    return {
      id: node.id,
      kind: node.kind,
      datasetId: node.datasetId,
      dataRevision: node.dataRevision,
      dataMissing: node.dataMissing ?? false,
      fields: node.fields,
    };
  }
  return { id: node.id, kind: node.kind };
}

/**
 * Hash only fields that affect evaluation. Position, color, label, tags,
 * parentId, collapse state and precision are intentionally excluded.
 */
export function computeEvalHash(project: Project, evalVersion = EVAL_VERSION): string {
  const nodes = Object.keys(project.nodes)
    .sort()
    .map((id) => nodeFingerprint(project.nodes[id]!));
  return hashString(stableStringify({ evalVersion, nodes }));
}

export function computeContentHash(rawBytesHash: string, parseParamsHash: string): string {
  return hashString(`${rawBytesHash}|${parseParamsHash}`);
}

export function computeDatasetHash(
  contentHash: string,
  parserVersion: string,
  outputDigest: string,
): string {
  return hashString(`${contentHash}|${parserVersion}|${outputDigest}`);
}
