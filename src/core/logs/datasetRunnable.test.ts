import { describe, expect, it } from 'vitest';
import type { DatasetMeta } from '@/core/model/types';
import { checkDatasetRunnable, datasetRunnable, type DatasetRuntimeFlags } from './datasetRunnable';

function makeMeta(overrides: Partial<DatasetMeta> = {}): DatasetMeta {
  return {
    id: 'ds1',
    name: '日志',
    format: 'csv',
    storage: 'blob',
    blobKey: 'p:1',
    parserVersion: '1',
    rawBytesHash: 'raw',
    parseParamsHash: 'params',
    contentHash: 'content',
    outputDigest: 'digest',
    columns: [{ id: 'c0', name: '伤害', type: 'number', sourceIndex: 0 }],
    rowCount: 3,
    datasetHash: 'hash',
    createdAt: 1,
    ...overrides,
  };
}

function makeRuntime(overrides: Partial<DatasetRuntimeFlags> = {}): DatasetRuntimeFlags {
  return {
    blobPresent: true,
    rowsLoaded: true,
    loadedDatasetHash: 'hash',
    rebuildState: 'idle',
    ...overrides,
  };
}

describe('datasetRunnable', () => {
  it('is runnable when blob is present, idle and hashes match', () => {
    expect(datasetRunnable(makeMeta(), makeRuntime())).toBe(true);
    expect(checkDatasetRunnable(makeMeta(), makeRuntime())).toEqual({ runnable: true });
  });

  it('rejects missing metadata or runtime flags', () => {
    expect(datasetRunnable(undefined, makeRuntime())).toBe(false);
    expect(datasetRunnable(makeMeta(), undefined)).toBe(false);
  });

  it('rejects data-unavailable datasets even with idle runtime', () => {
    expect(datasetRunnable(makeMeta({ dataUnavailable: true }), makeRuntime())).toBe(false);
  });

  it('rejects pending, rebuilding and error states', () => {
    for (const rebuildState of ['pending', 'rebuilding'] as const) {
      expect(datasetRunnable(makeMeta(), makeRuntime({ rebuildState }))).toBe(false);
    }
    expect(datasetRunnable(makeMeta(), makeRuntime({ rebuildState: 'error' }))).toBe(false);
  });

  it('rejects a stale loadedDatasetHash', () => {
    expect(datasetRunnable(makeMeta(), makeRuntime({ loadedDatasetHash: 'old' }))).toBe(false);
    expect(datasetRunnable(makeMeta(), makeRuntime({ loadedDatasetHash: undefined }))).toBe(false);
  });

  it('rejects integrity errors', () => {
    expect(datasetRunnable(makeMeta(), makeRuntime({ integrityError: 'hash mismatch' }))).toBe(false);
  });

  it('requires the blob for blob datasets and rows for manual datasets', () => {
    expect(datasetRunnable(makeMeta(), makeRuntime({ blobPresent: false }))).toBe(false);

    const manual = makeMeta({ storage: 'manual', blobKey: undefined, rawBytesHash: 'manual:v1' });
    expect(datasetRunnable(manual, makeRuntime({ blobPresent: false, rowsLoaded: false }))).toBe(false);
    expect(datasetRunnable(manual, makeRuntime({ blobPresent: false, rowsLoaded: true }))).toBe(true);
  });

  it('reports a reason for each rejection', () => {
    expect(checkDatasetRunnable(undefined, undefined).reason).toBeTruthy();
    expect(checkDatasetRunnable(makeMeta({ dataUnavailable: true }), makeRuntime()).reason).toContain(
      '数据源不可用',
    );
    expect(checkDatasetRunnable(makeMeta(), undefined).reason).toBeTruthy();
    expect(checkDatasetRunnable(makeMeta(), makeRuntime({ rebuildState: 'error', error: '坏行过多' })).reason).toBe(
      '坏行过多',
    );
    expect(checkDatasetRunnable(makeMeta(), makeRuntime({ rebuildState: 'pending' })).reason).toBe(
      '数据集待重建',
    );
    expect(checkDatasetRunnable(makeMeta(), makeRuntime({ loadedDatasetHash: 'old' })).reason).toContain(
      '重新解析',
    );
  });
});
