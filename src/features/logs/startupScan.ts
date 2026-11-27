import { markDatasetUnavailable } from '@/core/model/commands';
import { reconcileProjectBlobs } from '@/platform/storage/blobGc';
import { blobExists } from '@/platform/storage/idbBlob';
import { useProjectStore } from '@/stores/projectStore';
import { useRuntimeStore } from '@/stores/runtimeStore';

/**
 * Startup dataset scan, run by the leader tab after the project loads:
 *
 * - reconcile `pendingBlobGc` against the document (delete only blobs past the
 *   grace period that nothing references; register orphans without deleting)
 * - probe each blob dataset and seed runtime flags, so a missing source is
 *   reported before the user opens the dataset
 *
 * Parsed tables are never cached across sessions; the first use of a dataset
 * triggers the rebuild.
 */
export async function scanDatasetsOnStartup(): Promise<void> {
  const { project, readOnly, runCommand } = useProjectStore.getState();
  if (readOnly) return;

  try {
    await reconcileProjectBlobs(project);
  } catch {
    // GC is best effort; a failed pass must not block the workspace.
  }

  const runtime = useRuntimeStore.getState();
  for (const dataset of project.datasets) {
    if (dataset.storage !== 'blob') continue;
    if (!dataset.blobKey) continue;
    let present = false;
    try {
      present = await blobExists(dataset.blobKey);
    } catch {
      present = false;
    }
    if (!present) {
      runtime.removeDatasetRuntime(dataset.id);
      if (!dataset.dataUnavailable) {
        runCommand(
          '标记数据源缺失',
          (draft) => {
            markDatasetUnavailable(draft, dataset.id, '原始文件缺失，请重新导入或替换数据');
          },
          { system: true, datasetIds: [dataset.id] },
        );
      }
      continue;
    }
    runtime.setDatasetRuntime(dataset.id, {
      blobPresent: true,
      rowsLoaded: false,
      rebuildState: 'pending',
    });
  }
}
