import type { Filter, Metric } from '@/core/model/types';
import { wallTimeToEpoch } from './parse';
import type { ColumnarTable, ColumnVector } from './parse';

export type TimeBucketUnit = 'minute' | 'hour' | 'day' | 'month';

export interface AggregateOptions {
  filters?: Filter[];
  groupBy?: string[];
  metrics: Metric[];
  timeBucket?: { fieldId: string; unit: TimeBucketUnit };
  timeZone?: string;
  /** Safety cap on the number of output groups. */
  limit?: number;
}

export interface AggregateColumn {
  id: string;
  name: string;
  type: 'number' | 'string' | 'date';
}

export interface AggregateResult {
  columns: AggregateColumn[];
  rows: (string | number | null)[][];
  totalRows: number;
  filteredRows: number;
  truncated: boolean;
}

type Cell = string | number | null;

function readCell(vector: ColumnVector, rowIndex: number): Cell {
  if (vector.valid[rowIndex] !== 1) return null;
  if (vector.type === 'number' || vector.type === 'date') {
    return vector.values[rowIndex]!;
  }
  return vector.values[rowIndex] ?? null;
}

function compareCell(left: Cell, right: Cell): number {
  if (left === right) return 0;
  if (left === null) return -1;
  if (right === null) return 1;
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  return String(left).localeCompare(String(right), 'zh-Hans-CN');
}

function matchesFilter(cell: Cell, filter: Filter): boolean {
  const { op } = filter;
  if (op === 'isNull') return cell === null;
  if (op === 'notNull') return cell !== null;
  if (cell === null) return false;
  switch (op) {
    case 'eq':
      return cell === filter.value || String(cell) === String(filter.value);
    case 'neq':
      return !(cell === filter.value || String(cell) === String(filter.value));
    case 'gt':
      return typeof cell === 'number' && typeof filter.value === 'number' && cell > filter.value;
    case 'gte':
      return typeof cell === 'number' && typeof filter.value === 'number' && cell >= filter.value;
    case 'lt':
      return typeof cell === 'number' && typeof filter.value === 'number' && cell < filter.value;
    case 'lte':
      return typeof cell === 'number' && typeof filter.value === 'number' && cell <= filter.value;
    case 'in':
      return Array.isArray(filter.value) && filter.value.some((item) => String(item) === String(cell));
    case 'contains':
      return String(cell).includes(String(filter.value ?? ''));
    default:
      return false;
  }
}

export function percentile(sorted: number[], quantile: number): number | null {
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0]!;
  const position = (sorted.length - 1) * quantile;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower]!;
  const weight = position - lower;
  return sorted[lower]! * (1 - weight) + sorted[upper]! * weight;
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
    formatterCache.set(timeZone, formatter);
  }
  return formatter;
}

function zonedParts(epoch: number, timeZone?: string): ZonedParts {
  if (!timeZone) {
    const date = new Date(epoch);
    return {
      year: date.getFullYear(),
      month: date.getMonth() + 1,
      day: date.getDate(),
      hour: date.getHours(),
      minute: date.getMinutes(),
    };
  }
  const parts = formatterFor(timeZone).formatToParts(new Date(epoch));
  const map: Record<string, number> = {};
  for (const part of parts) {
    if (part.type !== 'literal') map[part.type] = Number(part.value);
  }
  return {
    year: map.year ?? 1970,
    month: map.month ?? 1,
    day: map.day ?? 1,
    hour: map.hour ?? 0,
    minute: map.minute ?? 0,
  };
}

/** Truncate an epoch-ms timestamp to the start of its bucket in a zone. */
export function bucketStart(
  epoch: number,
  unit: TimeBucketUnit,
  timeZone?: string,
): number {
  const parts = zonedParts(epoch, timeZone);
  if (unit === 'month') {
    return wallTimeToEpoch(parts.year, parts.month, 1, 0, 0, 0, 0, timeZone);
  }
  if (unit === 'day') {
    return wallTimeToEpoch(parts.year, parts.month, parts.day, 0, 0, 0, 0, timeZone);
  }
  if (unit === 'hour') {
    return wallTimeToEpoch(parts.year, parts.month, parts.day, parts.hour, 0, 0, 0, timeZone);
  }
  return wallTimeToEpoch(parts.year, parts.month, parts.day, parts.hour, parts.minute, 0, 0, timeZone);
}

interface MetricSpec {
  metric: Metric;
  /** Null when the field is missing or not numeric: the metric yields null. */
  vector: NumericSpecVector | null;
  /** Percentiles need the raw values; sums/counts/min/max accumulate in place. */
  collectValues: boolean;
}

type NumericSpecVector = { values: Float64Array; valid: Uint8Array };

interface MetricAccumulator {
  sum: number;
  count: number;
  min: number;
  max: number;
  values: number[] | null;
}

interface GroupState {
  keys: Cell[];
  rowCount: number;
  metrics: MetricAccumulator[];
}

function createAccumulator(collectValues: boolean): MetricAccumulator {
  return {
    sum: 0,
    count: 0,
    min: Number.POSITIVE_INFINITY,
    max: Number.NEGATIVE_INFINITY,
    values: collectValues ? [] : null,
  };
}

function accumulatorValue(accumulator: MetricAccumulator, op: Metric['op']): number | null {
  if (op === 'count') return accumulator.count;
  if (accumulator.count === 0) return op === 'sum' ? 0 : null;
  switch (op) {
    case 'sum':
      return accumulator.sum;
    case 'avg':
      return accumulator.sum / accumulator.count;
    case 'min':
      return accumulator.min;
    case 'max':
      return accumulator.max;
    case 'median': {
      const sorted = [...accumulator.values!].sort((a, b) => a - b);
      return percentile(sorted, 0.5);
    }
    case 'p90': {
      const sorted = [...accumulator.values!].sort((a, b) => a - b);
      return percentile(sorted, 0.9);
    }
    case 'p95': {
      const sorted = [...accumulator.values!].sort((a, b) => a - b);
      return percentile(sorted, 0.95);
    }
    default:
      return null;
  }
}

/** Order-stable key for a group tuple without allocating a JSON string. */
function encodeGroupKey(keys: Cell[]): string | number | null {
  if (keys.length === 1) {
    // Single-column keys (numbers, strings, buckets) go into the map as-is;
    // a given query never mixes raw and composite key shapes.
    return keys[0] ?? null;
  }
  let out = '';
  for (const cell of keys) {
    if (cell === null) out += '\u0000';
    else if (typeof cell === 'number') out += `n${cell};`;
    else out += `s${cell.length}:${cell};`;
  }
  return out;
}

/**
 * Filter, group and aggregate a columnar table. Pure and synchronous; the
 * worker runs this against the parsed columns.
 */
export function aggregateTable(table: ColumnarTable, options: AggregateOptions): AggregateResult {
  const filters = options.filters ?? [];
  const groupBy = options.groupBy ?? [];
  const limit = options.limit ?? 10000;

  const fieldIndex = new Map<string, number>();
  table.columns.forEach((column, index) => fieldIndex.set(column.id, index));

  const filterVectors = filters.map((filter) => {
    const index = fieldIndex.get(filter.fieldId);
    return index === undefined ? null : table.vectors[index]!;
  });

  const bucketIndex = options.timeBucket
    ? fieldIndex.get(options.timeBucket.fieldId)
    : undefined;

  const groupVectors = groupBy.map((columnId) => {
    const index = fieldIndex.get(columnId);
    return index === undefined ? null : table.vectors[index]!;
  });
  const groupIsBucket = groupBy.map((columnId) => {
    const index = fieldIndex.get(columnId);
    return options.timeBucket !== undefined && index !== undefined && index === bucketIndex;
  });

  const specs: MetricSpec[] = options.metrics.map((metric) => {
    if (metric.op === 'count') return { metric, vector: null, collectValues: false };
    const index = metric.fieldId ? fieldIndex.get(metric.fieldId) : undefined;
    const vector = index === undefined ? undefined : table.vectors[index];
    const numeric =
      vector && (vector.type === 'number' || vector.type === 'date')
        ? { values: vector.values, valid: vector.valid }
        : null;
    const collectValues =
      metric.op === 'median' || metric.op === 'p90' || metric.op === 'p95';
    return { metric, vector: numeric, collectValues };
  });

  // Repeated timestamps are bucketed once; with an IANA zone each conversion
  // costs an Intl format, so caching is what makes time grouping usable.
  const bucketCache = new Map<number, number>();
  const groups = new Map<string | number | null, GroupState>();
  let filteredRows = 0;
  let truncated = false;

  for (let rowIndex = 0; rowIndex < table.rowCount; rowIndex += 1) {
    let matched = true;
    for (let filterIndex = 0; filterIndex < filters.length; filterIndex += 1) {
      const vector = filterVectors[filterIndex];
      if (!vector) {
        matched = false;
        break;
      }
      if (!matchesFilter(readCell(vector, rowIndex), filters[filterIndex]!)) {
        matched = false;
        break;
      }
    }
    if (!matched) continue;
    filteredRows += 1;

    const keys: Cell[] = new Array<Cell>(groupVectors.length);
    for (let groupIndex = 0; groupIndex < groupVectors.length; groupIndex += 1) {
      const vector = groupVectors[groupIndex];
      if (!vector) {
        keys[groupIndex] = null;
        continue;
      }
      let cell = readCell(vector, rowIndex);
      if (groupIsBucket[groupIndex] && typeof cell === 'number' && vector.type === 'date') {
        const cached = bucketCache.get(cell);
        if (cached === undefined) {
          const bucket = bucketStart(cell, options.timeBucket!.unit, options.timeZone);
          bucketCache.set(cell, bucket);
          keys[groupIndex] = bucket;
        } else {
          keys[groupIndex] = cached;
        }
        continue;
      }
      keys[groupIndex] = cell;
    }

    const key = encodeGroupKey(keys);
    let state = groups.get(key);
    if (!state) {
      if (groups.size >= limit) {
        truncated = true;
        continue;
      }
      state = {
        keys,
        rowCount: 0,
        metrics: specs.map((spec) => createAccumulator(spec.collectValues)),
      };
      groups.set(key, state);
    }
    state.rowCount += 1;

    for (let metricIndex = 0; metricIndex < specs.length; metricIndex += 1) {
      const spec = specs[metricIndex]!;
      const accumulator = state.metrics[metricIndex]!;
      if (spec.metric.op === 'count') {
        accumulator.count += 1;
        continue;
      }
      const vector = spec.vector;
      if (!vector || vector.valid[rowIndex] !== 1) continue;
      const value = vector.values[rowIndex]!;
      accumulator.sum += value;
      accumulator.count += 1;
      if (value < accumulator.min) accumulator.min = value;
      if (value > accumulator.max) accumulator.max = value;
      accumulator.values?.push(value);
    }
  }

  const sortedGroups = [...groups.values()].sort((left, right) => {
    for (let index = 0; index < left.keys.length; index += 1) {
      const comparison = compareCell(left.keys[index] ?? null, right.keys[index] ?? null);
      if (comparison !== 0) return comparison;
    }
    return 0;
  });

  const columns: AggregateColumn[] = [
    ...groupBy.map((columnId) => {
      const index = fieldIndex.get(columnId);
      const column = index === undefined ? undefined : table.columns[index];
      if (!column) {
        return { id: columnId, name: columnId, type: 'string' as const };
      }
      if (options.timeBucket && index === bucketIndex) {
        return {
          id: columnId,
          name: `${column.name}（${bucketLabel(options.timeBucket.unit)}）`,
          type: 'date' as const,
        };
      }
      return { id: columnId, name: column.name, type: column.type as AggregateColumn['type'] };
    }),
    ...options.metrics.map((metric) => ({
      id: `metric:${metric.id}`,
      name: metric.alias,
      type: 'number' as const,
    })),
  ];

  const rows = sortedGroups.map((state) => [
    ...state.keys,
    ...specs.map((spec, metricIndex) => {
      const accumulator = state.metrics[metricIndex]!;
      if (spec.metric.op === 'count') return accumulator.count;
      if (!spec.vector) return null;
      return accumulatorValue(accumulator, spec.metric.op);
    }),
  ]);

  return { columns, rows, totalRows: table.rowCount, filteredRows, truncated };
}

function bucketLabel(unit: TimeBucketUnit): string {
  switch (unit) {
    case 'minute':
      return '分钟';
    case 'hour':
      return '小时';
    case 'day':
      return '日';
    case 'month':
      return '月';
  }
}

/** Read a whole column as display strings for previews. */
export function columnPreview(table: ColumnarTable, columnIndex: number, limit = 20): (string | null)[] {
  const vector = table.vectors[columnIndex];
  if (!vector) return [];
  const count = Math.min(limit, table.rowCount);
  const output: (string | null)[] = [];
  for (let rowIndex = 0; rowIndex < count; rowIndex += 1) {
    const cell = readCell(vector, rowIndex);
    output.push(cell === null ? null : String(cell));
  }
  return output;
}
