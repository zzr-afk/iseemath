import type { DatasetColumn, FieldType } from '@/core/model/types';
import { makeColumnId } from './datasetHash';

export interface NumericVector {
  type: 'number' | 'date';
  /** Number values, or epoch milliseconds for date columns. */
  values: Float64Array;
  /** 1 = present, 0 = null or bad. */
  valid: Uint8Array;
  nullCount: number;
  badCount: number;
}

export interface TextVector {
  type: 'string' | 'enum';
  values: (string | undefined)[];
  valid: Uint8Array;
  nullCount: number;
  badCount: number;
}

export type ColumnVector = NumericVector | TextVector;

/** First `limit` rows of a table, sharing vectors when nothing needs slicing. */
export function sliceTable(table: ColumnarTable, limit: number): ColumnarTable {
  const rowCount = Math.min(limit, table.rowCount);
  if (rowCount === table.rowCount) return table;
  const vectors: ColumnVector[] = table.vectors.map((vector) => {
    if (Array.isArray(vector.values)) {
      return {
        type: vector.type as TextVector['type'],
        values: (vector.values as (string | undefined)[]).slice(0, rowCount),
        valid: vector.valid.slice(0, rowCount),
        nullCount: vector.nullCount,
        badCount: vector.badCount,
      };
    }
    return {
      type: vector.type as NumericVector['type'],
      values: (vector.values as Float64Array).slice(0, rowCount),
      valid: vector.valid.slice(0, rowCount),
      nullCount: vector.nullCount,
      badCount: vector.badCount,
    };
  });
  return { ...table, vectors, rowCount };
}

export interface ColumnarTable {
  columns: DatasetColumn[];
  vectors: ColumnVector[];
  rowCount: number;
  /** Rows whose cell count differed from the header. */
  raggedRows: number;
  header: string[];
}

export interface ColumnTypeOverride {
  [sourceIndex: number]: FieldType;
}

export interface BuildTableOptions {
  hasHeader?: boolean;
  types?: ColumnTypeOverride;
  sampleSize?: number;
  /** Source IANA time zone for date columns; defaults to browser local time. */
  timeZone?: string;
  dateFormat?: string;
}

const NUMERIC_PATTERN = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

export function isBlankCell(cell: string | undefined): boolean {
  return cell === undefined || cell.trim().length === 0;
}

/** Strict decimal/scientific parse. Returns null for anything else. */
export function parseNumberCell(cell: string): number | null {
  const text = cell.trim();
  if (!NUMERIC_PATTERN.test(text)) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

function isValidDateParts(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  if (hour > 23 || minute > 59 || second > 59) return false;
  const check = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  return (
    check.getUTCFullYear() === year &&
    check.getUTCMonth() === month - 1 &&
    check.getUTCDate() === day &&
    check.getUTCHours() === hour &&
    check.getUTCMinutes() === minute &&
    check.getUTCSeconds() === second
  );
}

function zoneOffset(epoch: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(epoch));
  const map: Record<string, number> = {};
  for (const part of parts) {
    if (part.type !== 'literal') map[part.type] = Number(part.value);
  }
  const asUtc = Date.UTC(
    map.year ?? 1970,
    (map.month ?? 1) - 1,
    map.day ?? 1,
    map.hour ?? 0,
    map.minute ?? 0,
    map.second ?? 0,
  );
  return asUtc - epoch;
}

/** Wall-clock time in an IANA zone → epoch ms. */
export function wallTimeToEpoch(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  millisecond: number,
  timeZone?: string,
): number {
  if (!timeZone) {
    return new Date(year, month - 1, day, hour, minute, second, millisecond).getTime();
  }
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);
  let epoch = utcGuess - zoneOffset(utcGuess, timeZone);
  epoch = utcGuess - zoneOffset(epoch, timeZone);
  return epoch;
}

/**
 * Parse a date cell to epoch ms. Accepts ISO 8601 (with zone), `YYYY-MM-DD`,
 * `YYYY-MM-DD HH:mm[:ss[.SSS]]` interpreted in `timeZone`, and explicit
 * `epoch-ms` / `epoch-s` formats.
 */
export function parseDateCell(
  cell: string,
  options: { timeZone?: string; dateFormat?: string } = {},
): number | null {
  const text = cell.trim();
  if (!text) return null;
  if (options.dateFormat === 'epoch-ms' || options.dateFormat === 'epoch-s') {
    if (!NUMERIC_PATTERN.test(text)) return null;
    const value = Number(text);
    if (!Number.isFinite(value)) return null;
    return options.dateFormat === 'epoch-s' ? value * 1000 : value;
  }

  const dateOnly = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (dateOnly) {
    const [year, month, day] = dateOnly.slice(1).map(Number) as [number, number, number];
    if (!isValidDateParts(year, month, day, 0, 0, 0)) return null;
    return wallTimeToEpoch(year, month, day, 0, 0, 0, 0, options.timeZone);
  }

  const dateTime =
    /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:?\d{2})?$/.exec(
      text,
    );
  if (!dateTime) return null;
  const [, y, mo, d, h, mi, s, ms, zone] = dateTime;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  const hour = Number(h);
  const minute = Number(mi);
  const second = Number(s ?? 0);
  const millisecond = Number((ms ?? '0').padEnd(3, '0'));
  if (!isValidDateParts(year, month, day, hour, minute, second)) return null;
  if (zone) {
    const normalized = `${y}-${mo!.padStart(2, '0')}-${d!.padStart(2, '0')}T${h!.padStart(2, '0')}:${mi}${s ? `:${s}` : ''}${ms ? `.${ms}` : ''}${zone === 'Z' ? 'Z' : zone}`;
    const parsed = Date.parse(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return wallTimeToEpoch(year, month, day, hour, minute, second, millisecond, options.timeZone);
}

function normalizeHeaderName(raw: string | undefined, index: number, used: Set<string>): string {
  const base = (raw ?? '').trim() || `列${index + 1}`;
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate.toLowerCase())) {
    candidate = `${base} (${suffix})`;
    suffix += 1;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

function inferColumnType(
  rows: string[][],
  sourceIndex: number,
  sampleSize: number,
): FieldType {
  let sawNumber = false;
  const limit = Math.min(rows.length, sampleSize);
  for (let index = 0; index < limit; index += 1) {
    const cell = rows[index]?.[sourceIndex];
    if (isBlankCell(cell)) continue;
    if (parseNumberCell(cell!) === null) return 'string';
    sawNumber = true;
  }
  return sawNumber ? 'number' : 'string';
}

function createVector(type: FieldType, rowCount: number): ColumnVector {
  if (type === 'number' || type === 'date') {
    return {
      type,
      values: new Float64Array(rowCount),
      valid: new Uint8Array(rowCount),
      nullCount: 0,
      badCount: 0,
    };
  }
  return {
    type,
    values: new Array<string | undefined>(rowCount),
    valid: new Uint8Array(rowCount),
    nullCount: 0,
    badCount: 0,
  };
}

/**
 * Convert raw CSV/JSONL rows into columnar storage with validity masks.
 * Blank cells are null, unparseable cells are bad; neither pollutes values.
 */
export function buildColumnarTable(
  records: string[][],
  options: BuildTableOptions = {},
): ColumnarTable {
  const hasHeader = options.hasHeader ?? true;
  const sampleSize = options.sampleSize ?? 1000;
  if (records.length === 0) {
    return { columns: [], vectors: [], rowCount: 0, raggedRows: 0, header: [] };
  }

  const headerRow = hasHeader ? (records[0] ?? []) : [];
  const dataRows = hasHeader ? records.slice(1) : records;
  const width = hasHeader
    ? headerRow.length
    : records.reduce((max, row) => Math.max(max, row.length), 0);

  const used = new Set<string>();
  const header: string[] = [];
  for (let index = 0; index < width; index += 1) {
    header.push(normalizeHeaderName(headerRow[index], index, used));
  }

  const types: FieldType[] = header.map((_, index) => {
    const override = options.types?.[index];
    if (override) return override;
    return inferColumnType(dataRows, index, sampleSize);
  });

  const columns: DatasetColumn[] = header.map((name, sourceIndex) => ({
    id: makeColumnId(sourceIndex, name),
    name,
    type: types[sourceIndex]!,
    sourceIndex,
  }));
  const vectors = columns.map((column) => createVector(column.type, dataRows.length));

  let raggedRows = 0;
  for (let rowIndex = 0; rowIndex < dataRows.length; rowIndex += 1) {
    const row = dataRows[rowIndex]!;
    if (row.length !== width) raggedRows += 1;
    for (let columnIndex = 0; columnIndex < width; columnIndex += 1) {
      const vector = vectors[columnIndex]!;
      const cell = row[columnIndex];
      if (isBlankCell(cell)) {
        vector.nullCount += 1;
        continue;
      }
      const text = cell!;
      if (vector.type === 'number' || vector.type === 'date') {
        const parsed =
          vector.type === 'number'
            ? parseNumberCell(text)
            : parseDateCell(text, {
                timeZone: options.timeZone,
                dateFormat: options.dateFormat,
              });
        if (parsed === null) {
          vector.badCount += 1;
        } else {
          vector.values[rowIndex] = parsed;
          vector.valid[rowIndex] = 1;
        }
      } else {
        vector.values[rowIndex] = text;
        vector.valid[rowIndex] = 1;
      }
    }
  }

  return { columns, vectors, rowCount: dataRows.length, raggedRows, header };
}

/** Convert JSONL objects into the same columnar shape (keys become columns). */
export function buildTableFromObjects(
  objects: unknown[],
  options: BuildTableOptions = {},
): ColumnarTable {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const item of objects) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) continue;
    for (const key of Object.keys(item as Record<string, unknown>)) {
      if (!seen.has(key)) {
        seen.add(key);
        keys.push(key);
      }
    }
  }
  const records: string[][] = [keys];
  for (const item of objects) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      records.push([]);
      continue;
    }
    const record = item as Record<string, unknown>;
    records.push(
      keys.map((key) => {
        const value = record[key];
        if (value === null || value === undefined) return '';
        if (typeof value === 'object') return JSON.stringify(value);
        return String(value);
      }),
    );
  }
  return buildColumnarTable(records, options);
}
