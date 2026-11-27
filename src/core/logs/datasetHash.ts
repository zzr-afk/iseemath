import type { DatasetColumn, DatasetMeta, FieldType } from '@/core/model/types';
import { hashString, stableStringify } from '@/core/eval/hash';
import type { ColumnarTable } from './parse';

export const PARSER_VERSION = '1';

/** Hash raw file bytes without decoding them. */
export function hashBytes(bytes: Uint8Array): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let index = 0; index < bytes.length; index += 1) {
    const value = bytes[index]!;
    h1 ^= value;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= value + index;
    h2 = Math.imul(h2, 0x85ebca6b);
  }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}

/** Stable column id from source position + normalized source name. */
export function makeColumnId(sourceIndex: number, name: string): string {
  return `c${sourceIndex}:${hashString(name.trim().toLowerCase())}`;
}

export type ParseParams = Pick<
  DatasetMeta,
  'format' | 'encoding' | 'delimiter' | 'hasHeader' | 'sheet' | 'timeZone' | 'dateFormat'
>;

export function computeParseParamsHash(params: ParseParams): string {
  return hashString(
    stableStringify({
      format: params.format,
      encoding: params.encoding ?? '',
      delimiter: params.delimiter ?? '',
      hasHeader: params.hasHeader ?? null,
      sheet: params.sheet ?? '',
      timeZone: params.timeZone ?? '',
      dateFormat: params.dateFormat ?? '',
    }),
  );
}

/**
 * Schema hash for an analysis view: only the referenced columns matter, and
 * ordering does not. Returns one hash so it can be stored on the view.
 */
export function computeSchemaHash(columns: DatasetColumn[], referencedIds?: string[]): string {
  const ids = referencedIds ? new Set(referencedIds) : null;
  const signature = columns
    .filter((column) => !ids || ids.has(column.id))
    .map((column) => `${column.id}\u0001${column.type}`)
    .sort()
    .join('\u0002');
  return hashString(signature);
}

/** Incremental FNV-style digest; same shape as hashString but streamable. */
export class HashDigest {
  private h1 = 0x811c9dc5;
  private h2 = 0x01000193;
  private position = 0;

  update(part: string): this {
    for (let index = 0; index < part.length; index += 1) {
      const code = part.charCodeAt(index);
      this.h1 ^= code;
      this.h1 = Math.imul(this.h1, 0x01000193);
      this.h2 ^= code + this.position;
      this.h2 = Math.imul(this.h2, 0x85ebca6b);
      this.position += 1;
    }
    return this;
  }

  hex(): string {
    return (
      (this.h1 >>> 0).toString(16).padStart(8, '0') +
      (this.h2 >>> 0).toString(16).padStart(8, '0')
    );
  }
}

function formatNumberForDigest(value: number): string {
  if (Object.is(value, -0)) return '0';
  return String(value);
}

/**
 * Parsed-output digest: column schema (id/sourceIndex/name/type), row count,
 * per-column null/bad counts and every value. Used to detect silent drift
 * between rebuilds.
 */
export function computeOutputDigest(table: ColumnarTable): string {
  const digest = new HashDigest();
  for (const column of table.columns) {
    digest.update(
      `${column.id}\u0001${column.sourceIndex}\u0001${column.name}\u0001${column.type}\u0002`,
    );
  }
  digest.update(`rows\u0001${table.rowCount}\u0002`);
  for (const vector of table.vectors) {
    digest.update(`nulls\u0001${vector.nullCount}\u0001${vector.badCount}\u0002`);
    for (let index = 0; index < table.rowCount; index += 1) {
      if (vector.valid[index] !== 1) {
        digest.update('\u0000');
        continue;
      }
      if (vector.type === 'number' || vector.type === 'date') {
        digest.update(`${formatNumberForDigest(vector.values[index]!)}\u0001`);
      } else {
        digest.update(`${vector.values[index] ?? ''}\u0001`);
      }
    }
  }
  return digest.hex();
}

export function columnTypeCompatible(actual: FieldType, expected: FieldType): boolean {
  if (actual === expected) return true;
  // Enum values are stored as strings; a string column can satisfy an enum
  // field, but the reverse is not true.
  return actual === 'string' && expected === 'enum';
}
