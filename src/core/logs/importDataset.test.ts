import { describe, expect, it } from 'vitest';
import { decodeBytes, detectDelimiter } from './decode';
import { importDataset } from './importDataset';
import type { ColumnTypeOverride } from './parse';
import { hashBytes } from './datasetHash';

const encoder = new TextEncoder();

function utf8(text: string): Uint8Array {
  return encoder.encode(text);
}

function withUtf8Bom(bytes: Uint8Array): Uint8Array {
  const output = new Uint8Array(bytes.length + 3);
  output.set([0xef, 0xbb, 0xbf, ...bytes]);
  return output;
}

// "等级,伤害\n1,100\n2,200\n" encoded as GB18030.
const GBK_CSV = new Uint8Array([
  0xb5, 0xc8, 0xbc, 0xb6, 0x2c, 0xc9, 0xcb, 0xba, 0xa6, 0x0a, 0x31, 0x2c, 0x31, 0x30, 0x30, 0x0a,
  0x32, 0x2c, 0x32, 0x30, 0x30, 0x0a,
]);

describe('decodeBytes', () => {
  it('falls back to GB18030 for non-UTF-8 Chinese logs', () => {
    const decoded = decodeBytes(GBK_CSV);
    expect(decoded.encoding).toBe('gb18030');
    expect(decoded.text).toContain('等级');
    expect(decoded.text).toContain('伤害');
  });

  it('honors BOMs and explicit encodings', () => {
    const bom = decodeBytes(withUtf8Bom(utf8('姓名,分数\n小明,9\n')));
    expect(bom.encoding).toBe('utf-8');
    expect(bom.text.startsWith('姓名')).toBe(true);

    const explicit = decodeBytes(GBK_CSV, 'gb18030');
    expect(explicit.encoding).toBe('gb18030');
    expect(explicit.text).toContain('等级');
  });

  it('detects common delimiters outside quotes', () => {
    expect(detectDelimiter('a,b,c\n1,2,3')).toBe(',');
    expect(detectDelimiter('a\tb\tc\n1\t2\t3')).toBe('\t');
    expect(detectDelimiter('a;b;c\n1;2;3')).toBe(';');
    expect(detectDelimiter('"a,b",c\n1,2')).toBe(',');
    expect(detectDelimiter('single')).toBe(',');
  });
});

describe('importDataset', () => {
  it('imports GB18030 CSV with inferred numeric columns', () => {
    const result = importDataset({
      datasetId: 'd1',
      name: '战斗日志',
      fileName: 'battle.csv',
      bytes: GBK_CSV,
    });
    expect(result.encoding).toBe('gb18030');
    expect(result.table.header).toEqual(['等级', '伤害']);
    expect(result.table.rowCount).toBe(2);
    expect(result.meta.columns.map((column) => column.type)).toEqual(['number', 'number']);
    expect(result.meta.storage).toBe('manual');
    expect(result.meta.datasetHash).toHaveLength(16);
    expect(result.meta.datasetHash).toBe(
      importDataset({ datasetId: 'd1', name: '战斗日志', fileName: 'battle.csv', bytes: GBK_CSV })
        .meta.datasetHash,
    );
  });

  it('detects the delimiter and stores it in metadata', () => {
    const bytes = utf8('等级\t伤害\n1\t100\n2\t200\n');
    const result = importDataset({
      datasetId: 'd2',
      name: 'tab',
      fileName: 'tab.csv',
      bytes,
    });
    expect(result.delimiter).toBe('\t');
    expect(result.meta.delimiter).toBe('\t');
    expect(result.table.header).toEqual(['等级', '伤害']);
  });

  it('imports JSONL, skipping bad lines but keeping good ones', () => {
    const bytes = utf8('{"关卡":1,"伤害":10}\n坏行\n{"关卡":2,"伤害":20}\n');
    const result = importDataset({
      datasetId: 'd3',
      name: 'jsonl',
      fileName: 'battle.jsonl',
      bytes,
    });
    expect(result.badLines).toBe(1);
    expect(result.table.header).toEqual(['关卡', '伤害']);
    expect(result.table.rowCount).toBe(2);
    expect(result.meta.format).toBe('jsonl');
  });

  it('changes the dataset hash when bytes change', () => {
    const first = importDataset({
      datasetId: 'd4',
      name: 'a',
      fileName: 'a.csv',
      bytes: utf8('a,b\n1,2\n'),
    });
    const second = importDataset({
      datasetId: 'd4',
      name: 'a',
      fileName: 'a.csv',
      bytes: utf8('a,b\n1,3\n'),
    });
    expect(second.meta.rawBytesHash).not.toBe(first.meta.rawBytesHash);
    expect(second.meta.datasetHash).not.toBe(first.meta.datasetHash);
  });

  it('rejects empty files and reports the parser failure', () => {
    expect(() =>
      importDataset({ datasetId: 'd5', name: 'empty', fileName: 'empty.csv', bytes: utf8('') }),
    ).toThrow(/为空/);
    expect(() =>
      importDataset({
        datasetId: 'd6',
        name: 'bad',
        fileName: 'bad.jsonl',
        bytes: utf8('not json\n'),
      }),
    ).toThrow(/损坏/);
  });

  it('hashes raw bytes without decoding', () => {
    expect(hashBytes(GBK_CSV)).toBe(hashBytes(GBK_CSV.slice()));
    expect(hashBytes(GBK_CSV)).not.toBe(hashBytes(utf8('different')));
  });

  it('applies explicit column types and rebuilds to the same hash', () => {
    const bytes = utf8('等级,时间\n1,2024-01-01 08:00:00\n2,2024-01-02 09:30:00\n');
    const inferred = importDataset({
      datasetId: 'd7',
      name: 'time',
      fileName: 'time.csv',
      bytes,
      timeZone: 'Asia/Shanghai',
    });
    expect(inferred.meta.columns.map((column) => column.type)).toEqual(['number', 'string']);

    const typed = importDataset({
      datasetId: 'd7',
      name: 'time',
      fileName: 'time.csv',
      bytes,
      timeZone: 'Asia/Shanghai',
      types: { 1: 'date' },
    });
    expect(typed.meta.columns.map((column) => column.type)).toEqual(['number', 'date']);
    const timeVector = typed.table.vectors[1]!;
    expect(timeVector.type).toBe('date');
    expect(timeVector.badCount).toBe(0);
    // 2024-01-01 08:00 at UTC+8.
    expect(timeVector.values[0]).toBe(Date.UTC(2024, 0, 1, 0, 0, 0));
    expect(typed.meta.datasetHash).not.toBe(inferred.meta.datasetHash);

    // Rebuilding from stored metadata must reproduce the stored types/hash.
    const rebuildTypes: ColumnTypeOverride = {};
    for (const column of typed.meta.columns) rebuildTypes[column.sourceIndex] = column.type;
    const rebuilt = importDataset({
      datasetId: 'd7',
      name: 'time',
      fileName: 'time.csv',
      bytes,
      timeZone: 'Asia/Shanghai',
      types: rebuildTypes,
    });
    expect(rebuilt.meta.datasetHash).toBe(typed.meta.datasetHash);
    expect(rebuilt.meta.columns).toEqual(typed.meta.columns);
  });

  it('counts unparseable cells as bad for forced date columns', () => {
    const result = importDataset({
      datasetId: 'd8',
      name: 'bad-date',
      fileName: 'bad-date.csv',
      bytes: utf8('时间,备注\n2024-01-01,a\nnot-a-date,b\n,c\n'),
      types: { 0: 'date' },
    });
    const vector = result.table.vectors[0]!;
    expect(vector.type).toBe('date');
    expect(vector.valid[0]).toBe(1);
    expect(vector.valid[1]).toBe(0);
    expect(vector.badCount).toBe(1);
    expect(vector.nullCount).toBe(1);
  });
});
