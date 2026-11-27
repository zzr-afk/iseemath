import type { DatasetMeta } from '@/core/model/types';

/**
 * The runtime flags that decide whether a dataset may be used. Mirrors
 * `DatasetRuntime` in the runtime store without importing it: `core` stays
 * free of store dependencies.
 */
export interface DatasetRuntimeFlags {
  blobPresent: boolean;
  rowsLoaded: boolean;
  loadedDatasetHash?: string;
  rebuildState: 'idle' | 'pending' | 'rebuilding' | 'error';
  integrityError?: string;
  error?: string;
}

export interface RunnableVerdict {
  runnable: boolean;
  /** Human-readable reason when not runnable, for UI hints. */
  reason?: string;
}

/**
 * Single availability predicate for datasets. Pure and synchronous: it only
 * reads the precomputed runtime flags, never IndexedDB or the parse cache.
 * View execution, comparison runs and freshness checks must all go through it.
 */
export function checkDatasetRunnable(
  meta: DatasetMeta | undefined,
  runtime: DatasetRuntimeFlags | undefined,
): RunnableVerdict {
  if (!meta) return { runnable: false, reason: '数据集不存在' };
  if (meta.dataUnavailable) return { runnable: false, reason: '数据源不可用，请重新导入或替换数据' };
  if (!runtime) return { runnable: false, reason: '数据集尚未加载' };
  if (runtime.rebuildState === 'error') {
    return { runnable: false, reason: runtime.error ?? '解析失败，请重试' };
  }
  if (runtime.rebuildState !== 'idle') return { runnable: false, reason: '数据集待重建' };
  if (runtime.integrityError) return { runnable: false, reason: runtime.integrityError };
  if (meta.storage === 'manual') {
    if (!runtime.rowsLoaded) return { runnable: false, reason: '行数据尚未载入' };
  } else if (!runtime.blobPresent) {
    return { runnable: false, reason: '原始文件缺失' };
  }
  if (runtime.loadedDatasetHash !== meta.datasetHash) {
    return { runnable: false, reason: '数据集内容已变化，待重新解析' };
  }
  return { runnable: true };
}

export function datasetRunnable(
  meta: DatasetMeta | undefined,
  runtime: DatasetRuntimeFlags | undefined,
): boolean {
  return checkDatasetRunnable(meta, runtime).runnable;
}
