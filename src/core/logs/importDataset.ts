import type { DatasetMeta } from '@/core/model/types';
import { computeContentHash, computeDatasetHash } from '@/core/eval/hash';
import { CsvTokenizer } from './csvTokenizer';
import { JsonlParser } from './jsonl';
import {
  buildColumnarTable,
  buildTableFromObjects,
  type ColumnTypeOverride,
  type ColumnarTable,
} from './parse';
import {
  PARSER_VERSION,
  computeOutputDigest,
  computeParseParamsHash,
  hashBytes,
} from './datasetHash';
import { decodeBytes, detectDelimiter, type SupportedEncoding } from './decode';

export interface ImportDatasetOptions {
  datasetId: string;
  name: string;
  fileName: string;
  bytes: Uint8Array;
  blobKey?: string;
  encoding?: SupportedEncoding;
  /** Empty/undefined = detect from the first line. */
  delimiter?: string;
  hasHeader?: boolean;
  /** Explicit per-source-column types; unset columns use inference. */
  types?: ColumnTypeOverride;
  timeZone?: string;
  dateFormat?: string;
  createdAt?: number;
}

export interface ImportDatasetResult {
  meta: DatasetMeta;
  table: ColumnarTable;
  encoding: string;
  delimiter?: string;
  badLines: number;
  badLineSamples: string[];
}

export function inferFormat(fileName: string): 'csv' | 'jsonl' {
  return /\.jsonl?$/i.test(fileName) ? 'jsonl' : 'csv';
}

/**
 * Decode + parse a file into columns and DatasetMeta. Pure and synchronous;
 * large files should run the same code path inside a worker.
 */
export function importDataset(options: ImportDatasetOptions): ImportDatasetResult {
  const format = inferFormat(options.fileName);
  const { text, encoding } = decodeBytes(options.bytes, options.encoding ?? 'auto');
  const createdAt = options.createdAt ?? Date.now();

  let table: ColumnarTable;
  let delimiter: string | undefined;
  let badLines = 0;
  let badLineSamples: string[] = [];

  if (format === 'jsonl') {
    const parser = new JsonlParser();
    const values = [...parser.push(text), ...parser.end()];
    const stats = parser.stats;
    badLines = stats.badLines;
    badLineSamples = stats.samples;
    if (values.length === 0) {
      throw new Error(
        badLines > 0 ? `JSONL 没有可解析的行（${badLines} 行损坏）` : 'JSONL 文件为空',
      );
    }
    table = buildTableFromObjects(values, {
      hasHeader: true,
      types: options.types,
      timeZone: options.timeZone,
      dateFormat: options.dateFormat,
    });
  } else {
    delimiter = options.delimiter || detectDelimiter(text);
    const tokenizer = new CsvTokenizer({ delimiter });
    const records = [...tokenizer.push(text), ...tokenizer.end()];
    if (records.length === 0) throw new Error('CSV 文件为空');
    table = buildColumnarTable(records, {
      hasHeader: options.hasHeader ?? true,
      types: options.types,
      timeZone: options.timeZone,
      dateFormat: options.dateFormat,
    });
  }

  const rawBytesHash = hashBytes(options.bytes);
  const params = {
    format,
    encoding,
    delimiter,
    hasHeader: format === 'csv' ? (options.hasHeader ?? true) : undefined,
    timeZone: options.timeZone,
    dateFormat: options.dateFormat,
  };
  const parseParamsHash = computeParseParamsHash(params);
  const contentHash = computeContentHash(rawBytesHash, parseParamsHash);
  const outputDigest = computeOutputDigest(table);
  const datasetHash = computeDatasetHash(contentHash, PARSER_VERSION, outputDigest);

  const meta: DatasetMeta = {
    id: options.datasetId,
    name: options.name,
    format,
    storage: options.blobKey ? 'blob' : 'manual',
    blobKey: options.blobKey,
    encoding,
    delimiter,
    hasHeader: format === 'csv' ? (options.hasHeader ?? true) : undefined,
    timeZone: options.timeZone,
    dateFormat: options.dateFormat,
    parserVersion: PARSER_VERSION,
    rawBytesHash,
    parseParamsHash,
    contentHash,
    outputDigest,
    columns: table.columns,
    rowCount: table.rowCount,
    datasetHash,
    createdAt,
  };

  return { meta, table, encoding, delimiter, badLines, badLineSamples };
}
