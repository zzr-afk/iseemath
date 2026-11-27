import { nanoid } from 'nanoid';
import { db, type BlobMetaRow } from './db';

/** 8 MB chunks keep individual IndexedDB records well below browser limits. */
export const BLOB_CHUNK_SIZE = 8 * 1024 * 1024;

export function makeBlobKey(projectId: string): string {
  return `${projectId}:${nanoid()}`;
}

export async function putBlob(
  projectId: string,
  blobKey: string,
  bytes: Uint8Array,
  mime = 'text/plain',
  /** When set, register the blob for GC in the same transaction as the write. */
  gcDatasetId?: string,
): Promise<BlobMetaRow> {
  const chunkCount = Math.max(1, Math.ceil(bytes.byteLength / BLOB_CHUNK_SIZE));
  const meta: BlobMetaRow = {
    key: blobKey,
    projectId,
    byteLength: bytes.byteLength,
    chunkCount,
    mime,
    createdAt: Date.now(),
  };
  await db.transaction('rw', db.blobMeta, db.blobChunks, db.pendingBlobGc, async () => {
    await db.blobChunks.where('blobKey').equals(blobKey).delete();
    for (let index = 0; index < chunkCount; index += 1) {
      const start = index * BLOB_CHUNK_SIZE;
      const slice = bytes.subarray(start, Math.min(start + BLOB_CHUNK_SIZE, bytes.byteLength));
      const copy = new Uint8Array(slice.byteLength);
      copy.set(slice);
      await db.blobChunks.put({ blobKey, index, data: copy.buffer });
    }
    await db.blobMeta.put(meta);
    if (gcDatasetId !== undefined) {
      // Until the document references this key (and autosave persists it), a
      // crash must leave a collectable registration instead of an orphan blob.
      const existing = await db.pendingBlobGc.where('blobKey').equals(blobKey).first();
      if (existing) {
        await db.pendingBlobGc.update(existing.id!, { enqueuedAt: Date.now(), datasetId: gcDatasetId });
      } else {
        await db.pendingBlobGc.add({
          projectId,
          datasetId: gcDatasetId,
          blobKey,
          enqueuedAt: Date.now(),
        });
      }
    }
  });
  return meta;
}

export async function getBlobMeta(blobKey: string): Promise<BlobMetaRow | undefined> {
  return db.blobMeta.get(blobKey);
}

export async function blobExists(blobKey: string): Promise<boolean> {
  return (await db.blobMeta.get(blobKey)) !== undefined;
}

/** Assemble a Blob from stored chunks. Returns null if metadata/chunks disagree. */
export async function getBlob(blobKey: string): Promise<Blob | null> {
  const meta = await db.blobMeta.get(blobKey);
  if (!meta) return null;
  const chunks = await db.blobChunks.where('blobKey').equals(blobKey).toArray();
  chunks.sort((left, right) => left.index - right.index);
  if (chunks.length !== meta.chunkCount) return null;
  let byteLength = 0;
  for (const chunk of chunks) byteLength += chunk.data.byteLength;
  if (byteLength !== meta.byteLength) return null;
  return new Blob(chunks.map((chunk) => new Blob([chunk.data])), { type: meta.mime });
}

export async function getBlobBytes(blobKey: string): Promise<Uint8Array | null> {
  const blob = await getBlob(blobKey);
  if (!blob) return null;
  return new Uint8Array(await blob.arrayBuffer());
}

export async function deleteBlob(blobKey: string): Promise<void> {
  await db.transaction('rw', db.blobMeta, db.blobChunks, async () => {
    await db.blobChunks.where('blobKey').equals(blobKey).delete();
    await db.blobMeta.delete(blobKey);
  });
}

export async function listBlobKeys(projectId: string): Promise<string[]> {
  const rows = await db.blobMeta.where('projectId').equals(projectId).toArray();
  return rows.map((row) => row.key);
}
