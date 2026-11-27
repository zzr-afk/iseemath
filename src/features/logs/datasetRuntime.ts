import type { DatasetMeta } from '@/core/model/types';
import type { ColumnTypeOverride, ColumnarTable } from '@/core/logs/parse';
import { importDataset, type ImportDatasetOptions } from '@/core/logs/importDataset';
import { replaceDatasetMeta } from '@/core/model/commands';
import { revalidateCollectionFields } from '@/core/model/collection';
import { parseInWorker, WORKER_PARSE_THRESHOLD } from './logImportClient';
import { revalidateAnalysisViews } from '@/core/model/analysisViews';
import { getBlobBytes } from '@/platform/storage/idbBlob';
import { useProjectStore } from '@/stores/projectStore';
import { useRuntimeStore, type DatasetRuntime } from '@/stores/runtimeStore';
import { cacheTable, getCachedTable } from './tableCache';

function findMeta(datasetId: string): DatasetMeta | undefined {
  return useProjectStore.getState().project.datasets.find((dataset) => dataset.id === datasetId);
}

function fileNameFor(meta: DatasetMeta): string {
  return `${meta.name}.${meta.format === 'jsonl' ? 'jsonl' : 'csv'}`;
}

/**
 * Parse-relevant fields. Compared field-by-field rather than by
 * `parseParamsHash`: a settings change writes the new fields but intentionally
 * keeps the old hash until the rebuild adopts the new output, so a hash
 * comparison would discard every rebuild started after an edit.
 */
export function parseSettingsKey(meta: DatasetMeta): string {
  return [
    meta.format,
    meta.encoding ?? '',
    meta.delimiter ?? '',
    meta.hasHeader ?? true,
    meta.timeZone ?? '',
    meta.dateFormat ?? '',
  ].join('\u0001');
}

function sameParseSettings(left: DatasetMeta, right: DatasetMeta): boolean {
  return parseSettingsKey(left) === parseSettingsKey(right);
}

/** Stored column types are authoritative so rebuilds reproduce the same schema. */
function typeOverrides(meta: DatasetMeta): ColumnTypeOverride {
  const types: ColumnTypeOverride = {};
  for (const column of meta.columns) types[column.sourceIndex] = column.type;
  return types;
}

function markRuntime(datasetId: string, update: Partial<DatasetRuntime>): void {
  const current = useRuntimeStore.getState().datasetRuntime[datasetId] ?? {
    blobPresent: false,
    rowsLoaded: false,
    rebuildState: 'pending' as const,
  };
  useRuntimeStore.getState().setDatasetRuntime(datasetId, { ...current, ...update });
}

const rebuilds = new Map<string, Promise<ColumnarTable | null>>();

/** Bumped when parse settings change so in-flight rebuilds become stale. */
const rebuildEpochs = new Map<string, number>();

export function invalidateDatasetRebuild(datasetId: string): void {
  rebuildEpochs.set(datasetId, (rebuildEpochs.get(datasetId) ?? 0) + 1);
}

/**
 * Return the parsed table for a dataset, rebuilding from the stored blob when
 * the in-memory cache is missing (e.g. after a refresh). Rebuilds are safe to
 * repeat and only write metadata back when the digest actually changed.
 * Concurrent callers for the same hash share one parse.
 */
export function ensureDatasetTable(datasetId: string): Promise<ColumnarTable | null> {
  const meta = findMeta(datasetId);
  if (!meta) return Promise.resolve(null);
  // A replacement owns this dataset until it commits or aborts; never parse the
  // outgoing source in the meantime.
  if (useRuntimeStore.getState().replaceState?.datasetId === datasetId) {
    return Promise.resolve(getCachedTable(datasetId, meta.datasetHash) ?? null);
  }
  const epoch = rebuildEpochs.get(datasetId) ?? 0;
  const key = `${datasetId}:${meta.datasetHash}:${epoch}`;
  const running = rebuilds.get(key);
  if (running) return running;
  const task = rebuildDatasetTable(datasetId);
  rebuilds.set(key, task);
  void task.finally(() => {
    if (rebuilds.get(key) === task) rebuilds.delete(key);
  });
  return task;
}

async function rebuildDatasetTable(datasetId: string): Promise<ColumnarTable | null> {
  const meta = findMeta(datasetId);
  if (!meta) return null;
  const epoch = rebuildEpochs.get(datasetId) ?? 0;

  const cached = getCachedTable(datasetId, meta.datasetHash);
  if (cached) return cached;
  if (useRuntimeStore.getState().replaceState?.datasetId === datasetId) return null;

  if (meta.dataUnavailable || !meta.blobKey) {
    markRuntime(datasetId, {
      blobPresent: false,
      rowsLoaded: false,
      rebuildState: 'error',
      error: '数据源缺失，请重新导入或替换数据',
    });
    return null;
  }

  markRuntime(datasetId, {
    blobPresent: true,
    rowsLoaded: false,
    rebuildState: 'rebuilding',
    error: undefined,
    integrityError: undefined,
  });

  try {
    const bytes = await getBlobBytes(meta.blobKey);
    if (!bytes) {
      markRuntime(datasetId, {
        blobPresent: false,
        rowsLoaded: false,
        rebuildState: 'error',
        error: '原始文件中不存在或已损坏',
      });
      return null;
    }

    const options: ImportDatasetOptions = {
      datasetId: meta.id,
      name: meta.name,
      fileName: fileNameFor(meta),
      bytes,
      blobKey: meta.blobKey,
      encoding: (meta.encoding as 'utf-8' | 'gb18030' | 'utf-16le' | undefined) ?? 'auto',
      delimiter: meta.delimiter,
      hasHeader: meta.hasHeader ?? true,
      types: typeOverrides(meta),
      timeZone: meta.timeZone,
      dateFormat: meta.dateFormat,
      createdAt: meta.createdAt,
    };

    // Large rebuilds run off the main thread so the canvas and UI stay usable.
    const result =
      typeof Worker !== 'undefined' && bytes.byteLength > WORKER_PARSE_THRESHOLD
        ? await parseInWorker(options)
        : importDataset(options);

    // Parse settings may have changed while this rebuild was running; the
    // newer task owns the result and the runtime flags.
    const latest = findMeta(datasetId);
    if (
      !latest ||
      (rebuildEpochs.get(datasetId) ?? 0) !== epoch ||
      useRuntimeStore.getState().replaceState?.datasetId === datasetId ||
      !sameParseSettings(latest, meta) ||
      latest.rawBytesHash !== meta.rawBytesHash
    ) {
      return null;
    }

    if (result.meta.rawBytesHash !== meta.rawBytesHash) {
      markRuntime(datasetId, {
        blobPresent: true,
        rowsLoaded: false,
        rebuildState: 'error',
        integrityError: '原始文件内容与元数据不一致',
      });
      return null;
    }

    // Same bytes, same parser, same parse params but a different output digest:
    // the parser is non-deterministic or the stored output drifted. A settings
    // change or parser upgrade legitimately changes the digest, so skip those.
    const runtimeBefore = useRuntimeStore.getState().datasetRuntime[datasetId];
    const drift =
      Boolean(runtimeBefore && !runtimeBefore.expectOutputChange) &&
      latest.datasetHash !== result.meta.datasetHash &&
      latest.parserVersion === result.meta.parserVersion &&
      latest.rawBytesHash === result.meta.rawBytesHash &&
      latest.parseParamsHash === result.meta.parseParamsHash &&
      latest.outputDigest !== result.meta.outputDigest;

    let nextMeta = latest;
    if (result.meta.datasetHash !== latest.datasetHash) {
      // Parser upgrade, changed parse settings or silent data drift: adopt the
      // new output and let the normal autosave persist it. dataRevision bumps
      // on bound collections once collection support lands in M3.
      nextMeta = {
        ...latest,
        columns: result.meta.columns,
        rowCount: result.meta.rowCount,
        parserVersion: result.meta.parserVersion,
        outputDigest: result.meta.outputDigest,
        datasetHash: result.meta.datasetHash,
        parseParamsHash: result.meta.parseParamsHash,
        hasHeader: result.meta.hasHeader,
        encoding: result.meta.encoding,
        delimiter: result.meta.delimiter,
        dataUnavailable: undefined,
      };
      useProjectStore.getState().runCommand(
        '重建数据集',
        (draft) => {
          replaceDatasetMeta(draft, nextMeta);
          revalidateCollectionFields(draft, datasetId);
          revalidateAnalysisViews(draft, datasetId);
        },
        { system: true, datasetIds: [datasetId] },
      );
    }

    cacheTable(datasetId, nextMeta.datasetHash, result.table);
    markRuntime(datasetId, {
      blobPresent: true,
      rowsLoaded: true,
      loadedDatasetHash: nextMeta.datasetHash,
      rebuildState: 'idle',
      error: undefined,
      integrityError: undefined,
      progress: 1,
      expectOutputChange: undefined,
      driftWarning: drift
        ? '重新解析的输出与上次不一致：解析器行为可能已变化或数据被外部改动，已采用新结果。'
        : undefined,
    });
    return result.table;
  } catch (error) {
    // A failed rebuild of the outgoing source must not stomp the replacement's
    // runtime state.
    if (useRuntimeStore.getState().replaceState?.datasetId === datasetId) return null;
    markRuntime(datasetId, {
      blobPresent: true,
      rowsLoaded: false,
      rebuildState: 'error',
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
