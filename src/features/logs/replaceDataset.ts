import { nanoid } from 'nanoid';
import type { DatasetMeta } from '@/core/model/types';
import type { ColumnTypeOverride, ColumnarTable } from '@/core/logs/parse';
import { importDataset, type ImportDatasetOptions } from '@/core/logs/importDataset';
import { stableStringify } from '@/core/eval/hash';
import { replaceDatasetMeta } from '@/core/model/commands';
import { revalidateCollectionFields } from '@/core/model/collection';
import { revalidateAnalysisViews } from '@/core/model/analysisViews';
import { clearBlobGc, enqueueBlobGc } from '@/platform/storage/blobGc';
import { makeBlobKey, putBlob } from '@/platform/storage/idbBlob';
import { useProjectStore } from '@/stores/projectStore';
import { useRuntimeStore } from '@/stores/runtimeStore';
import { ensureDatasetTable } from './datasetRuntime';
import { parseInWorker, WORKER_PARSE_THRESHOLD } from './logImportClient';
import { cacheTable, dropTableCache } from './tableCache';

export type ReplaceOutcome =
  | { ok: true; table: ColumnarTable; meta: DatasetMeta }
  | { ok: false; error: string; cancelled?: boolean };

function typeOverrides(meta: DatasetMeta): ColumnTypeOverride {
  const types: ColumnTypeOverride = {};
  for (const column of meta.columns) types[column.sourceIndex] = column.type;
  return types;
}

/**
 * Replace a dataset's source file while keeping its identity (id, name,
 * analysis views, collection bindings).
 *
 * The new file is decoded with auto-detection (a replacement may be a different
 * export than the original), parsed before any document write, and committed as
 * exactly one undoable command. The old blob stays for the 24h undo window.
 * Any edit that changes the dataset while parsing cancels the replacement.
 */
export async function replaceDatasetSource(
  datasetId: string,
  fileName: string,
  bytes: Uint8Array,
): Promise<ReplaceOutcome> {
  const store = useProjectStore.getState();
  const meta = store.project.datasets.find((dataset) => dataset.id === datasetId);
  if (!meta) return { ok: false, error: '数据集不存在' };
  if (store.readOnly) return { ok: false, error: '当前标签页为只读，另一个标签页正在编辑该项目' };
  if (useRuntimeStore.getState().replaceState) {
    return { ok: false, error: '已有数据源正在替换，请等待完成' };
  }
  if (bytes.byteLength === 0) return { ok: false, error: '文件为空' };

  const projectId = store.project.id;
  const jobToken = nanoid();
  const newBlobKey = makeBlobKey(projectId);
  const baseMetaHash = stableStringify(meta);
  const runtime = useRuntimeStore.getState();

  try {
    await putBlob(projectId, newBlobKey, bytes, 'text/plain', datasetId);
  } catch (error) {
    return {
      ok: false,
      error: `无法保存新文件：${error instanceof Error ? error.message : String(error)}`,
    };
  }

  // From here on the dataset is "replacing": rebuilds for it are refused and the
  // UI shows a banner. Nothing has been written to the document yet.
  runtime.setReplaceState({
    datasetId,
    jobToken,
    newBlobKey,
    phase: 'parsing',
    baseDocRevision: store.docRevision,
    baseMetaHash,
  });
  runtime.setDatasetRuntime(datasetId, {
    blobPresent: true,
    rowsLoaded: false,
    rebuildState: 'pending',
  });

  const options: ImportDatasetOptions = {
    datasetId,
    name: meta.name,
    fileName,
    bytes,
    blobKey: newBlobKey,
    encoding: 'auto',
    hasHeader: meta.hasHeader ?? true,
    types: typeOverrides(meta),
    timeZone: meta.timeZone,
    dateFormat: meta.dateFormat,
    createdAt: meta.createdAt,
  };

  let result;
  try {
    result =
      typeof Worker !== 'undefined' && bytes.byteLength > WORKER_PARSE_THRESHOLD
        ? await parseInWorker(options)
        : importDataset(options);
  } catch (error) {
    await abortReplace(datasetId, newBlobKey);
    return {
      ok: false,
      error: `解析失败：${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const current = useRuntimeStore.getState().replaceState;
  const latest = useProjectStore.getState().project.datasets.find(
    (dataset) => dataset.id === datasetId,
  );
  if (
    !current ||
    current.jobToken !== jobToken ||
    !latest ||
    stableStringify(latest) !== baseMetaHash
  ) {
    await abortReplace(datasetId, newBlobKey);
    return { ok: false, error: '数据集在替换期间发生变化，本次替换已取消', cancelled: true };
  }

  const nextMeta: DatasetMeta = {
    ...result.meta,
    id: meta.id,
    name: meta.name,
    createdAt: meta.createdAt,
    storage: 'blob',
    blobKey: newBlobKey,
    dataUnavailable: undefined,
  };

  dropTableCache(datasetId);
  try {
    useProjectStore.getState().runCommand(
      '替换数据源',
      (draft) => {
        replaceDatasetMeta(draft, nextMeta);
        revalidateCollectionFields(draft, datasetId);
        revalidateAnalysisViews(draft, datasetId);
      },
      { datasetIds: [datasetId], blobKeys: [newBlobKey] },
    );
  } catch (error) {
    await abortReplace(datasetId, newBlobKey);
    return {
      ok: false,
      error: `无法提交替换：${error instanceof Error ? error.message : String(error)}`,
    };
  }

  // The document references the new blob now; drop the write-time registration.
  void clearBlobGc(newBlobKey).catch(() => undefined);
  cacheTable(datasetId, nextMeta.datasetHash, result.table);
  // The old file is only referenced by undo history now; the 24h grace makes
  // undoing the replacement safe.
  if (meta.blobKey && meta.blobKey !== newBlobKey) {
    void enqueueBlobGc(projectId, datasetId, meta.blobKey).catch(() => undefined);
  }

  const finalRuntime = useRuntimeStore.getState();
  finalRuntime.setReplaceState(undefined);
  finalRuntime.setDatasetRuntime(datasetId, {
    blobPresent: true,
    rowsLoaded: true,
    loadedDatasetHash: nextMeta.datasetHash,
    rebuildState: 'idle',
    error: undefined,
    integrityError: undefined,
    progress: 1,
  });

  return { ok: true, table: result.table, meta: nextMeta };
}

async function abortReplace(datasetId: string, newBlobKey: string): Promise<void> {
  const runtime = useRuntimeStore.getState();
  runtime.setReplaceState(undefined);
  const projectId = useProjectStore.getState().project.id;
  void enqueueBlobGc(projectId, datasetId, newBlobKey).catch(() => undefined);

  // Resume the dataset's original source. If it was never loaded this rebuilds
  // it; if a rebuild was in flight, it was discarded on the replace guard.
  const meta = useProjectStore.getState().project.datasets.find(
    (dataset) => dataset.id === datasetId,
  );
  if (!meta) return;
  runtime.setDatasetRuntime(datasetId, {
    blobPresent: true,
    rowsLoaded: false,
    loadedDatasetHash: undefined,
    rebuildState: 'pending',
  });
  void ensureDatasetTable(datasetId).catch(() => undefined);
}
