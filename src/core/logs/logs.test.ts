import { describe, expect, it } from 'vitest';
import { CsvTokenizer, parseCsv } from './csvTokenizer';
import { JsonlParser, parseJsonl } from './jsonl';

function parseInChunks(text: string, size: number): string[][] {
  const tokenizer = new CsvTokenizer();
  const records: string[][] = [];
  for (let index = 0; index < text.length; index += size) {
    records.push(...tokenizer.push(text.slice(index, index + size)));
  }
  records.push(...tokenizer.end());
  return records;
}

function jsonlInChunks(text: string, size: number): { values: unknown[]; badLines: number } {
  const parser = new JsonlParser();
  const values: unknown[] = [];
  for (let index = 0; index < text.length; index += size) {
    values.push(...parser.push(text.slice(index, index + size)));
  }
  values.push(...parser.end());
  return { values, badLines: parser.stats.badLines };
}

const csvFixture =
  '﻿等级,伤害,备注\r\n' +
  '1,100,"普通,攻击"\r\n' +
  '2,250,"带""引号""的技能"\r\n' +
  '3,400,"跨\n行描述"\r\n' +
  '4,550,第一行\r\n第二行式续行?\r\n' +
  '5,700,\r\n';

describe('CsvTokenizer', () => {
  it('parses headers, quoted commas, escaped quotes, CRLF and embedded newlines', () => {
    const records = parseCsv(csvFixture);
    expect(records[0]).toEqual(['等级', '伤害', '备注']);
    expect(records[1]).toEqual(['1', '100', '普通,攻击']);
    expect(records[2]).toEqual(['2', '250', '带"引号"的技能']);
    expect(records[3]).toEqual(['3', '400', '跨\n行描述']);
    expect(records[4]).toEqual(['4', '550', '第一行']);
    expect(records[5]).toEqual(['第二行式续行?']);
    expect(records[6]).toEqual(['5', '700', '']);
    expect(records).toHaveLength(7);
  });

  it('produces identical output for every single-character chunk split', () => {
    const expected = parseCsv(csvFixture);
    for (let size = 1; size <= csvFixture.length; size += 1) {
      expect(parseInChunks(csvFixture, size), `chunk size ${size}`).toEqual(expected);
    }
  });

  it('handles arbitrary two-way chunk splits inside quotes', () => {
    const expected = parseCsv(csvFixture);
    for (let split = 0; split <= csvFixture.length; split += 1) {
      const tokenizer = new CsvTokenizer();
      const records = [
        ...tokenizer.push(csvFixture.slice(0, split)),
        ...tokenizer.push(csvFixture.slice(split)),
        ...tokenizer.end(),
      ];
      expect(records, `split ${split}`).toEqual(expected);
    }
  });

  it('supports tab delimiters and skips blank lines', () => {
    const records = parseCsv('\n\nA\tB\n1\t2\r\n\r\n3\t4\n', { delimiter: '\t' });
    expect(records).toEqual([
      ['A', 'B'],
      ['1', '2'],
      ['3', '4'],
    ]);
  });

  it('tolerates an unterminated quoted field at EOF', () => {
    const records = parseCsv('a,b\n1,"unterminated');
    expect(records).toEqual([
      ['a', 'b'],
      ['1', 'unterminated'],
    ]);
  });

  it('keeps a quoted empty field distinguishable from an absent field', () => {
    expect(parseCsv('a,b,c\n1,"",3')).toEqual([['a', 'b', 'c'], ['1', '', '3']]);
  });
});

describe('JsonlParser', () => {
  const fixture = '﻿{"a":1}\r\n\n{"a":2,"text":"中文"}\n{"a":3}\n';

  it('parses lines, skips blanks and keeps values across chunks', () => {
    const { values, stats } = parseJsonl(fixture);
    expect(values).toEqual([{ a: 1 }, { a: 2, text: '中文' }, { a: 3 }]);
    expect(stats.badLines).toBe(0);
    expect(stats.lineCount).toBe(3);
  });

  it('matches whole-buffer parsing for every single-character chunk size', () => {
    const expected = parseJsonl(fixture).values;
    for (let size = 1; size <= fixture.length; size += 1) {
      expect(jsonlInChunks(fixture, size).values, `chunk size ${size}`).toEqual(expected);
    }
  });

  it('counts bad lines and samples them without aborting', () => {
    const { values, stats } = parseJsonl('{"a":1}\nnot json\n{"a":2}\n{"broken":\n');
    expect(values).toEqual([{ a: 1 }, { a: 2 }]);
    expect(stats.badLines).toBe(2);
    expect(stats.samples).toEqual(['not json', '{"broken":']);
  });

  it('throws on a bad line in strict mode', () => {
    expect(() => parseJsonl('{"a":1}\nnope\n', { strict: true })).toThrow(/第 2 行/);
  });

  it('parses a final line without a trailing newline', () => {
    const parser = new JsonlParser();
    expect(parser.push('{"a":1}\n{"a":')).toEqual([{ a: 1 }]);
    expect(parser.push('2}')).toEqual([]);
    expect(parser.end()).toEqual([{ a: 2 }]);
  });
});
