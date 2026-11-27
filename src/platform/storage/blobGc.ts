import type { Project } from '@/core/model/types';
import { db } from './db';
import { deleteBlob, listBlobKeys } from './idbBlob';

/**
 * Blobs referenced by a deleted/replaced dataset stay available for a day so
 * same-session undo can restore the dataset. Only entries older than this are
 * eligible for deletion.
 */
export const BLOB_GC_GRACE_MS = 24 * 60 * 60 * 1000;

/**
 * Register a blob for delayed collection. Safe to call repeatedly; a blob is
 * never deleted while the current document still references it (see
 * `reconcileProjectBlobs`).
 */
export async function enqueueBlobGc(
  projectId: string,
  datasetId: string,
  blobKey: string,
  enqueuedAt = Date.now(),
): Promise<void> {
  // Check and write in one transaction: concurrent registrations for the same
  // key (explicit delete path + reference sync) must update, not duplicate.
  // IndexedDB serializes readwrite transactions, so the check is authoritative.
  await db.transaction('rw', db.pendingBlobGc, async () => {
    const table = db.pendingBlobGc;
    const existing = await table.where('blobKey').equals(blobKey).first();
    if (existing) {
      // A re-deletion after an undo must restart the grace period, otherwise an
      // old timestamp could make the blob collectable immediately.
      await table.update(existing.id!, { enqueuedAt, datasetId });
      return;
    }
    await table.add({ projectId, datasetId, blobKey, enqueuedAt });
  });
}

/** Drop the GC registration once the document references the blob again. */
export async function clearBlobGc(blobKey: string): Promise<void> {
  await db.pendingBlobGc.where('blobKey').equals(blobKey).delete();
}

export interface BlobGcResult {
  deleted: string[];
  cleared: number;
  registered: number;
  kept: number;
}

/**
 * Reconcile one project's blobs with its document:
 * - referenced blob → drop its stale GC row
 * - unreferenced, registered, past the grace period → delete blob + row
 * - unreferenced, registered, within grace → keep (undo window)
 * - unreferenced, unregistered → register now (never delete immediately; the
 *   write may be in flight from another tab)
 */
export async function reconcileProjectBlobs(
  project: Project,
  now = Date.now(),
): Promise<BlobGcResult> {
  const referenced = new Set(
    project.datasets
      .map((dataset) => dataset.blobKey)
      .filter((key): key is string => Boolean(key)),
  );
  const result: BlobGcResult = { deleted: [], cleared: 0, registered: 0, kept: 0 };
  const allRows = await db.pendingBlobGc.where('projectId').equals(project.id).toArray();

  // Older builds / racing writers could leave several rows for one key. Keep
  // the newest and treat the rest as stale duplicates.
  const rowsByKey = new Map<string, typeof allRows>();
  for (const row of allRows) {
    const list = rowsByKey.get(row.blobKey) ?? [];
    list.push(row);
    rowsByKey.set(row.blobKey, list);
  }
  const rows = [...rowsByKey.values()].map((list) => {
    list.sort((left, right) => right.enqueuedAt - left.enqueuedAt);
    return list[0]!;
  });

  for (const row of allRows) {
    const newest = rowsByKey.get(row.blobKey)![0];
    if (row !== newest) {
      await db.pendingBlobGc.delete(row.id!);
      result.cleared += 1;
    }
  }

  for (const row of rows) {
    if (referenced.has(row.blobKey)) {
      await clearBlobGc(row.blobKey);
      result.cleared += 1;
      continue;
    }
    if (now - row.enqueuedAt <= BLOB_GC_GRACE_MS) {
      result.kept += 1;
      continue;
    }
    await deleteBlob(row.blobKey);
    await clearBlobGc(row.blobKey);
    result.deleted.push(row.blobKey);
  }

  const known = new Set(rows.map((row) => row.blobKey));
  for (const blobKey of await listBlobKeys(project.id)) {
    if (referenced.has(blobKey) || known.has(blobKey)) continue;
    await enqueueBlobGc(project.id, '', blobKey, now);
    result.registered += 1;
  }
  return result;
}
