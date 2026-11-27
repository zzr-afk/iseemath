import { db, type DraftRow, type ProjectRow, type ProjectViewRow } from './db';
import type { Project, ProjectViewState } from '@/core/model/types';

export class CasConflictError extends Error {
  constructor(public readonly storedRevision: number) {
    super(`项目已在其他标签页更新（存储版本 ${storedRevision}）`);
    this.name = 'CasConflictError';
  }
}

export class LeaseLostError extends Error {
  constructor() {
    super('当前标签页已失去写入权限');
    this.name = 'LeaseLostError';
  }
}

export async function listProjectRows(): Promise<ProjectRow[]> {
  const rows = await db.projects.toArray();
  return rows.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function loadProjectRow(projectId: string): Promise<ProjectRow | undefined> {
  return db.projects.get(projectId);
}

/**
 * Compare-and-swap document save. Reads the stored revision and lease token in
 * the same readwrite transaction that writes the new document.
 */
export async function saveDoc(
  projectId: string,
  doc: Project,
  baseRevision: number,
  leaseToken: number,
): Promise<number> {
  return db.transaction('rw', db.projects, db.leases, async () => {
    const lease = await db.leases.get(projectId);
    if (!lease || lease.leaseToken !== leaseToken) throw new LeaseLostError();

    const row = await db.projects.get(projectId);
    const storedRevision = row?.docRevision ?? 0;
    if (storedRevision !== baseRevision) throw new CasConflictError(storedRevision);

    const nextRevision = storedRevision + 1;
    await db.projects.put({
      id: projectId,
      doc,
      docRevision: nextRevision,
      updatedAt: Date.now(),
      schemaVersion: 1,
    });
    // Explicitly rewrite the fencing token so the check and write stay atomic.
    await db.leases.put({ ...lease, leaseToken });
    return nextRevision;
  });
}

export async function loadViewState(projectId: string): Promise<ProjectViewRow | undefined> {
  return db.projectViews.get(projectId);
}

export async function saveViewState(
  projectId: string,
  viewState: ProjectViewState,
  leaseToken: number,
): Promise<number> {
  return db.transaction('rw', db.projectViews, db.leases, async () => {
    const lease = await db.leases.get(projectId);
    if (!lease || lease.leaseToken !== leaseToken) throw new LeaseLostError();
    const row = await db.projectViews.get(projectId);
    const nextRevision = (row?.viewRevision ?? 0) + 1;
    await db.projectViews.put({
      projectId,
      viewState,
      viewRevision: nextRevision,
      updatedAt: Date.now(),
      schemaVersion: 1,
    });
    return nextRevision;
  });
}

export async function saveDraft(
  projectId: string,
  tabId: string,
  doc: Project,
  baseRevision: number,
): Promise<void> {
  const draft: DraftRow = {
    id: `${projectId}:${tabId}`,
    projectId,
    tabId,
    doc,
    baseRevision,
    savedAt: Date.now(),
  };
  await db.drafts.put(draft);
}

export async function loadDraft(
  projectId: string,
  tabId: string,
): Promise<DraftRow | undefined> {
  return db.drafts.get(`${projectId}:${tabId}`);
}

export async function deleteDraft(projectId: string, tabId: string): Promise<void> {
  await db.drafts.delete(`${projectId}:${tabId}`);
}

export async function deleteProjectCompletely(projectId: string): Promise<void> {
  await db.transaction(
    'rw',
    [
      db.projects,
      db.projectViews,
      db.leases,
      db.drafts,
      db.comparisonRuns,
      db.pendingBlobGc,
      db.pendingManualGc,
      db.projectCopies,
      db.copyItems,
      db.manualRowsStaging,
      db.leaseCandidates,
    ],
    async () => {
      await db.projects.delete(projectId);
      await db.projectViews.delete(projectId);
      await db.leases.delete(projectId);
      await db.drafts.where('projectId').equals(projectId).delete();
      await db.comparisonRuns.where('projectId').equals(projectId).delete();
      await db.pendingBlobGc.where('projectId').equals(projectId).delete();
      await db.pendingManualGc.where('projectId').equals(projectId).delete();
      await db.projectCopies.delete(projectId);
      await db.copyItems.where('projectId').equals(projectId).delete();
      await db.manualRowsStaging.where('projectId').equals(projectId).delete();
      await db.leaseCandidates.where('projectId').equals(projectId).delete();
    },
  );
}
