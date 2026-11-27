import { describe, expect, it } from 'vitest';
import {
  buildColumnarTable,
  buildTableFromObjects,
  parseDateCell,
  parseNumberCell,
  sliceTable,
} from './parse';
import {
  computeOutputDigest,
  computeParseParamsHash,
  computeSchemaHash,
  makeColumnId,
} from './datasetHash';

describe('cell parsing', () => {
  it('accepts strict decimal and scientific numbers only', () => {
    expect(parseNumberCell('12')).toBe(12);
    expect(parseNumberCell(' -3.5e2 ')).toBe(-350);
    expect(parseNumberCell('+0.25')).toBe(0.25);
    expect(parseNumberCell('.5')).toBe(0.5);
    expect(parseNumberCell('NaN')).toBeNull();
    expect(parseNumberCell('Infinity')).toBeNull();
    expect(parseNumberCell('0x10')).toBeNull();
    expect(parseNumberCell('1,000')).toBeNull();
    expect(parseNumberCell('1e999')).toBeNull();
  });

  it('parses dates with an explicit source time zone', () => {
    const shanghai = { timeZone: 'Asia/Shanghai' };
    expect(parseDateCell('2024-01-01 08:00:00', shanghai)).toBe(1704067200000);
    expect(parseDateCell('2024-01-01', shanghai)).toBe(1704038400000);
    expect(parseDateCell('2024-01-01T00:00:00Z')).toBe(1704067200000);
    expect(parseDateCell('2024-01-01T08:00:00+08:00')).toBe(1704067200000);
    expect(parseDateCell('2024-03-10 03:00:00', { timeZone: 'America/New_York' })).toBe(
      1710054000000,
    );
    expect(parseDateCell('2024-13-01')).toBeNull();
    expect(parseDateCell('not a date')).toBeNull();
  });

  it('supports epoch seconds and milliseconds formats', () => {
    expect(parseDateCell('1704067200', { dateFormat: 'epoch-s' })).toBe(1704067200000);
    expect(parseDateCell('1704067200000', { dateFormat: 'epoch-ms' })).toBe(1704067200000);
    expect(parseDateCell('1704067200.5', { dateFormat: 'epoch-s' })).toBe(1704067200500);
  });
});

describe('buildColumnarTable', () => {
  const records = [
    ['等级', '伤害', '备注'],
    ['1', '100', '普通攻击'],
    ['2', '', '技能'],
    ['3', 'oops', ''],
    ['4', '400'],
  ];

  it('infers types conservatively and tracks null cells in validity masks', () => {
    const table = buildColumnarTable(records);
    // One non-numeric cell keeps the damage column a string unless the user
    // explicitly marks it as numeric in the import wizard.
    expect(table.columns.map((column) => column.type)).toEqual(['number', 'string', 'string']);
    expect(table.rowCount).toBe(4);
    expect(table.raggedRows).toBe(1);

    const level = table.vectors[0]!;
    expect(level.type).toBe('number');
    expect(Array.from(level.valid)).toEqual([1, 1, 1, 1]);
    expect(Array.from(level.values as Float64Array)).toEqual([1, 2, 3, 4]);

    const damage = table.vectors[1]!;
    expect(damage.nullCount).toBe(1);
    expect(damage.badCount).toBe(0);
    expect(Array.from(damage.valid)).toEqual([1, 0, 1, 1]);
    expect(damage.values[0]).toBe('100');
    expect(damage.values[2]).toBe('oops');
    expect(damage.values[3]).toBe('400');

    const note = table.vectors[2]!;
    expect(note.type).toBe('string');
    expect(note.values[0]).toBe('普通攻击');
    expect(note.valid[3]).toBe(0);
  });

  it('counts bad cells when a numeric type is forced', () => {
    const table = buildColumnarTable(records, { types: { 1: 'number' } });
    const damage = table.vectors[1]!;
    expect(table.columns[1]!.type).toBe('number');
    expect(damage.nullCount).toBe(1);
    expect(damage.badCount).toBe(1);
    expect(Array.from(damage.valid)).toEqual([1, 0, 0, 1]);
    expect(Array.from(damage.values as Float64Array)).toEqual([100, 0, 0, 400]);
  });

  it('generates headers when the file has none', () => {
    const table = buildColumnarTable(
      [
        ['1', '2'],
        ['3', '4'],
      ],
      { hasHeader: false },
    );
    expect(table.header).toEqual(['列1', '列2']);
    expect(table.rowCount).toBe(2);
    expect(table.columns[0]!.type).toBe('number');
  });

  it('normalizes blank and duplicate headers', () => {
    const table = buildColumnarTable([
      ['', 'HP', 'hp', 'HP'],
      ['1', '2', '3', '4'],
    ]);
    expect(table.header).toEqual(['列1', 'HP', 'hp (2)', 'HP (3)']);
    expect(new Set(table.columns.map((column) => column.id)).size).toBe(4);
  });

  it('honors explicit column types and time zones', () => {
    const table = buildColumnarTable(
      [
        ['时间', '值'],
        ['2024-01-01 08:00:00', '5'],
      ],
      { types: { 0: 'date', 1: 'number' }, timeZone: 'Asia/Shanghai' },
    );
    const time = table.vectors[0]!;
    expect(time.type).toBe('date');
    expect(time.values[0]).toBe(1704067200000);
    expect(time.badCount).toBe(0);
  });

  it('keeps column ids stable across rebuilds and distinct per position', () => {
    const first = buildColumnarTable(records);
    const second = buildColumnarTable(records);
    expect(first.columns.map((column) => column.id)).toEqual(
      second.columns.map((column) => column.id),
    );
    expect(makeColumnId(0, ' HP ')).toBe(makeColumnId(0, 'hp'));
    expect(makeColumnId(0, 'hp')).not.toBe(makeColumnId(1, 'hp'));
  });
});

describe('dataset hashes', () => {
  it('schema hash depends on referenced column types and is order-independent', () => {
    const table = buildColumnarTable([
      ['a', 'b'],
      ['1', '2'],
    ]);
    const forward = computeSchemaHash(table.columns);
    const reversed = computeSchemaHash([...table.columns].reverse());
    expect(forward).toBe(reversed);

    const changed = computeSchemaHash(
      table.columns.map((column, index) =>
        index === 0 ? { ...column, type: 'string' as const } : column,
      ),
    );
    expect(changed).not.toBe(forward);

    const onlyFirst = computeSchemaHash(table.columns, [table.columns[0]!.id]);
    expect(onlyFirst).not.toBe(forward);
  });

  it('output digest is deterministic and reacts to values', () => {
    const base = [
      ['a', 'b'],
      ['1', 'x'],
      ['2', 'y'],
    ];
    const digest = computeOutputDigest(buildColumnarTable(base));
    expect(computeOutputDigest(buildColumnarTable(base))).toBe(digest);
    expect(
      computeOutputDigest(
        buildColumnarTable([
          ['a', 'b'],
          ['1', 'x'],
          ['3', 'y'],
        ]),
      ),
    ).not.toBe(digest);
  });

  it('parse params hash changes with time zone and delimiter', () => {
    const params = {
      format: 'csv' as const,
      encoding: 'utf-8',
      delimiter: ',',
      timeZone: 'Asia/Shanghai',
      dateFormat: 'auto',
    };
    const base = computeParseParamsHash(params);
    expect(computeParseParamsHash({ ...params })).toBe(base);
    expect(computeParseParamsHash({ ...params, timeZone: 'UTC' })).not.toBe(base);
    expect(computeParseParamsHash({ ...params, delimiter: '\t' })).not.toBe(base);
  });
});

describe('buildTableFromObjects', () => {
  it('unions JSONL keys and converts values to cells', () => {
    const table = buildTableFromObjects([
      { level: 1, hp: 100, extra: { nested: true } },
      { level: 2, hp: null },
    ]);
    expect(table.header).toEqual(['level', 'hp', 'extra']);
    expect(table.columns.map((column) => column.type)).toEqual(['number', 'number', 'string']);
    expect(table.rowCount).toBe(2);
    expect(table.vectors[2]!.values[0]).toBe('{"nested":true}');
    expect(table.vectors[1]!.nullCount).toBe(1);
  });
});


describe('sliceTable', () => {
  it('keeps the requested rows for numeric and text vectors', () => {
    const table = buildTableFromObjects([
      { level: 1, server: 'A' },
      { level: 2, server: 'B' },
      { level: 3, server: 'C' },
    ]);
    const sliced = sliceTable(table, 2);
    expect(sliced.rowCount).toBe(2);
    expect(Array.from((sliced.vectors[0] as { values: Float64Array }).values)).toEqual([1, 2]);
    expect((sliced.vectors[1] as { values: (string | undefined)[] }).values).toEqual(['A', 'B']);
    // The source table is untouched and a wider limit is a no-op.
    expect(table.rowCount).toBe(3);
    expect(sliceTable(table, 10)).toBe(table);
  });
});
