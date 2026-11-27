import { describe, expect, it } from 'vitest';
import { aggregateTable, bucketStart, percentile } from './aggregate';
import { buildColumnarTable } from './parse';

const table = buildColumnarTable(
  [
    ['区服', '伤害', '暴击', '时间'],
    ['A', '10', '0', '2024-01-01 07:00:00'],
    ['A', '20', '1', '2024-01-01 09:00:00'],
    ['B', '5', '', '2024-01-02 01:00:00'],
    ['B', '40', '1', '2024-01-02 23:00:00'],
    ['A', 'oops', '1', '2024-01-03 00:30:00'],
  ],
  { types: { 1: 'number', 2: 'number', 3: 'date' }, timeZone: 'Asia/Shanghai' },
);

const ids = Object.fromEntries(table.columns.map((column) => [column.name, column.id])) as Record<
  string,
  string
>;
const id = (name: string) => ids[name]!;

describe('aggregateTable', () => {
  it('aggregates the whole table with all metric types', () => {
    const result = aggregateTable(table, {
      metrics: [
        { id: 'c', op: 'count', alias: '行数' },
        { id: 's', op: 'sum', fieldId: id('伤害'), alias: '总伤害' },
        { id: 'a', op: 'avg', fieldId: id('伤害'), alias: '平均伤害' },
        { id: 'mn', op: 'min', fieldId: id('伤害'), alias: '最小' },
        { id: 'mx', op: 'max', fieldId: id('伤害'), alias: '最大' },
        { id: 'p', op: 'p90', fieldId: id('伤害'), alias: 'P90' },
      ],
    });
    expect(result.columns.map((column) => column.name)).toEqual([
      '行数',
      '总伤害',
      '平均伤害',
      '最小',
      '最大',
      'P90',
    ]);
    expect(result.rows).toHaveLength(1);
    const row = result.rows[0]!;
    expect(row[0]).toBe(5);
    expect(row[1]).toBe(75);
    expect(row[2]).toBe(75 / 4);
    expect(row[3]).toBe(5);
    expect(row[4]).toBe(40);
    expect(row[5]).toBeCloseTo(34); // sorted [5,10,20,40] → 0.9 position 2.7
    expect(result.totalRows).toBe(5);
    expect(result.filteredRows).toBe(5);
  });

  it('groups by one column and sorts keys', () => {
    const result = aggregateTable(table, {
      groupBy: [id('区服')],
      metrics: [
        { id: 'c', op: 'count', alias: '行数' },
        { id: 's', op: 'sum', fieldId: id('伤害'), alias: '总伤害' },
        { id: 'm', op: 'median', fieldId: id('伤害'), alias: '中位数' },
      ],
    });
    expect(result.rows).toEqual([
      ['A', 3, 30, 15],
      ['B', 2, 45, 22.5],
    ]);
  });

  it('applies numeric and string filters before grouping', () => {
    const result = aggregateTable(table, {
      filters: [
        { fieldId: id('伤害'), op: 'gte', value: 20 },
        { fieldId: id('区服'), op: 'in', value: ['A'] },
      ],
      groupBy: [id('区服')],
      metrics: [{ id: 'c', op: 'count', alias: '行数' }],
    });
    expect(result.filteredRows).toBe(1);
    expect(result.rows).toEqual([['A', 1]]);
  });

  it('counts nulls without polluting aggregates', () => {
    const result = aggregateTable(table, {
      metrics: [
        { id: 'c', op: 'count', alias: '行数' },
        { id: 'a', op: 'avg', fieldId: id('暴击'), alias: '暴击率' },
        { id: 'n', op: 'sum', fieldId: id('不存在'), alias: '缺失列' },
      ],
    });
    expect(result.rows[0]).toEqual([5, 0.75, null]);
  });

  it('buckets dates by local day in the source time zone', () => {
    const result = aggregateTable(table, {
      groupBy: [id('时间')],
      timeBucket: { fieldId: id('时间'), unit: 'day' },
      timeZone: 'Asia/Shanghai',
      metrics: [{ id: 's', op: 'sum', fieldId: id('伤害'), alias: '总伤害' }],
    });
    expect(result.columns[0]!.name).toContain('日');
    expect(result.rows.map((row) => row[0])).toEqual([
      Date.UTC(2023, 11, 31, 16),
      Date.UTC(2024, 0, 1, 16),
      Date.UTC(2024, 0, 2, 16),
    ]);
    expect(result.rows.map((row) => row[1])).toEqual([30, 45, 0]);
  });

  it('caps the number of groups and reports truncation', () => {
    const result = aggregateTable(table, {
      groupBy: [id('区服')],
      metrics: [{ id: 'c', op: 'count', alias: '行数' }],
      limit: 1,
    });
    expect(result.rows).toHaveLength(1);
    expect(result.truncated).toBe(true);
  });

  it('handles missing group-by columns without crashing', () => {
    const result = aggregateTable(table, {
      groupBy: ['missing-column'],
      metrics: [{ id: 'c', op: 'count', alias: '行数' }],
    });
    expect(result.rows).toEqual([[null, 5]]);
    expect(result.columns[0]).toEqual({ id: 'missing-column', name: 'missing-column', type: 'string' });
  });
});

describe('percentile and buckets', () => {
  it('interpolates percentiles linearly', () => {
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(percentile([1, 2, 3, 4], 0.9)).toBeCloseTo(3.7);
    expect(percentile([], 0.9)).toBeNull();
    expect(percentile([7], 0.9)).toBe(7);
  });

  it('truncates timestamps in local zones', () => {
    const epoch = Date.UTC(2024, 0, 1, 20, 35, 10); // Jan 2 04:35 in Shanghai
    expect(bucketStart(epoch, 'hour', 'Asia/Shanghai')).toBe(Date.UTC(2024, 0, 1, 20));
    expect(bucketStart(epoch, 'day', 'Asia/Shanghai')).toBe(Date.UTC(2024, 0, 1, 16));
    expect(bucketStart(epoch, 'month', 'Asia/Shanghai')).toBe(Date.UTC(2023, 11, 31, 16));
  });
});
