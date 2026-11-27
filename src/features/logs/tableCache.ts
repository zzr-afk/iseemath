import type { ColumnarTable } from '@/core/logs/parse';

interface CacheEntry {
  datasetHash: string;
  table: ColumnarTable;
}

/**
 * Parsed columns live outside React/Zustand so large arrays never enter the
 * document store or trigger renders. Keyed by dataset hash so stale parses are
 * ignored automatically.
 */
const cache = new Map<string, CacheEntry>();

export function cacheTable(datasetId: string, datasetHash: string, table: ColumnarTable): void {
  cache.set(datasetId, { datasetHash, table });
}

export function getCachedTable(datasetId: string, datasetHash: string): ColumnarTable | undefined {
  const entry = cache.get(datasetId);
  if (!entry || entry.datasetHash !== datasetHash) return undefined;
  return entry.table;
}

export function hasCachedTable(datasetId: string): boolean {
  return cache.has(datasetId);
}

export function dropTableCache(datasetId?: string): void {
  if (datasetId) cache.delete(datasetId);
  else cache.clear();
}
