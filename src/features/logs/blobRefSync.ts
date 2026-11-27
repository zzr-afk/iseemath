import { clearBlobGc, enqueueBlobGc } from '@/platform/storage/blobGc';
import { useProjectStore, type UndoEntry } from '@/stores/projectStore';
import type { Project } from '@/core/model/types';

interface BlobRefs {
  projectId: string;
  /** blobKey -> datasetId, used only as a hint when registering a collected blob. */
  keys: Map<string, string>;
}

function collectRefs(project: Project, undoStack: UndoEntry[], redoStack: UndoEntry[]): BlobRefs {
  const keys = new Map<string, string>();
  for (const dataset of project.datasets) {
    if (dataset.blobKey) keys.set(dataset.blobKey, dataset.id);
  }
  // History entries keep replaced/deleted blobs alive for same-session undo.
  for (const entry of [...undoStack, ...redoStack]) {
    for (const key of entry.blobKeys) {
      if (!keys.has(key)) keys.set(key, entry.datasetIds[0] ?? '');
    }
  }
  return { projectId: project.id, keys };
}

let lastRefs: BlobRefs | null = null;

/**
 * Keep `pendingBlobGc` in step with the reference set (document + memory
 * history) after undo/redo, history trims and system writes:
 * - a key that stopped being referenced → register it for delayed collection
 * - a key that became referenced again (undo of a delete/replace) → unregister
 * Never touches another project's blobs, so switching projects is inert.
 */
export function syncBlobReferences(): void {
  const { project, undoStack, redoStack } = useProjectStore.getState();
  const current = collectRefs(project, undoStack, redoStack);
  const previous = lastRefs;
  lastRefs = current;
  if (!previous || previous.projectId !== current.projectId) return;

  for (const [key, datasetId] of previous.keys) {
    if (!current.keys.has(key)) {
      void enqueueBlobGc(current.projectId, datasetId, key).catch(() => undefined);
    }
  }
  for (const key of current.keys.keys()) {
    if (!previous.keys.has(key)) {
      void clearBlobGc(key).catch(() => undefined);
    }
  }
}

let unsubscribe: (() => void) | null = null;

/** Seed the baseline from the loaded project, then follow store changes. */
export function initBlobRefSync(): void {
  if (unsubscribe) return;
  const { project, undoStack, redoStack } = useProjectStore.getState();
  lastRefs = collectRefs(project, undoStack, redoStack);
  unsubscribe = useProjectStore.subscribe(() => syncBlobReferences());
}
