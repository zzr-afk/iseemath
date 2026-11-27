import { nanoid } from 'nanoid';
import { useProjectStore } from '@/stores/projectStore';
import { createEmptyViewState, useViewStore } from '@/stores/viewStore';
import { usePersistenceStore } from '@/stores/persistenceStore';
import { createEmptyProject } from '@/core/model/factories';
import { validateProject } from '@/core/model/invariants';
import { parseProject } from '@/core/model/projectSchema';
import { MAX_IMPORT_BYTES } from '@/core/model/projectSchema';
import type { Project, ProjectViewState } from '@/core/model/types';
import { db, indexedDbAvailable, type ProjectRow } from './db';
import {
  CasConflictError,
  LeaseLostError,
  deleteDraft,
  listProjectRows,
  loadProjectRow,
  loadViewState,
  saveDoc,
  saveDraft,
  saveViewState,
} from './projectRepo';
import {
  LEASE_HEARTBEAT_MS,
  acquireLease,
  getTabId,
  heartbeat,
  releaseLease,
} from './tabLease';

const LAST_PROJECT_KEY = 'iseemath:lastProjectId';
const CHANNEL_NAME = 'iseemath:doc';
const SAVE_DEBOUNCE_MS = 500;

let started = false;
let initPromise: Promise<void> | null = null;
let tabId = '';
let activeProjectId: string | null = null;
let leaseToken: number | null = null;
let baseRevision = 0;
let suppress = false;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let saveInFlight = false;
let saveQueued = false;
let viewTimer: ReturnType<typeof setTimeout> | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let channel: BroadcastChannel | null = null;
let persistenceEnabled = false;

function canSave(): boolean {
  return (
    persistenceEnabled &&
    activeProjectId !== null &&
    leaseToken !== null &&
    !useProjectStore.getState().readOnly &&
    usePersistenceStore.getState().status !== 'conflict'
  );
}

function scheduleSave(delay = SAVE_DEBOUNCE_MS): void {
  if (!canSave()) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void performSave();
  }, delay);
}

function scheduleViewSave(delay = SAVE_DEBOUNCE_MS): void {
  if (!persistenceEnabled || activeProjectId === null || leaseToken === null) return;
  if (viewTimer) clearTimeout(viewTimer);
  viewTimer = setTimeout(() => {
    viewTimer = null;
    void performViewSave();
  }, delay);
}

async function performSave(): Promise<void> {
  const pid = activeProjectId;
  const token = leaseToken;
  if (!pid || token === null) return;
  if (saveInFlight) {
    saveQueued = true;
    return;
  }

  saveInFlight = true;
  const state = useProjectStore.getState();
  const snapshotRevision = state.docRevision;
  const doc = state.project;
  usePersistenceStore.getState().setStatus('saving');

  try {
    const nextRevision = await saveDoc(pid, doc, baseRevision, token);
    baseRevision = nextRevision;
    usePersistenceStore.getState().markSaved(Date.now());
    void deleteDraft(pid, tabId).catch(() => undefined);
    channel?.postMessage({
      type: 'docChanged',
      projectId: pid,
      docRevision: nextRevision,
      tabId,
    });
  } catch (error) {
    if (error instanceof CasConflictError) {
      try {
        await saveDraft(pid, tabId, doc, baseRevision);
      } catch {
        // The in-memory document is still intact; the user can export it.
      }
      usePersistenceStore.getState().setDraftAvailable(true);
      usePersistenceStore
        .getState()
        .setStatus('conflict', '项目已在其他标签页修改，本地改动已存为草稿');
      useProjectStore.getState().setReadOnly(true);
    } else if (error instanceof LeaseLostError) {
      downgradeToReadOnly();
    } else {
      usePersistenceStore
        .getState()
        .setStatus('error', error instanceof Error ? error.message : String(error));
    }
  } finally {
    saveInFlight = false;
    if (saveQueued) {
      saveQueued = false;
      if (canSave()) scheduleSave(0);
    } else if (canSave() && useProjectStore.getState().docRevision !== snapshotRevision) {
      scheduleSave(0);
    }
  }
}

async function performViewSave(): Promise<void> {
  const pid = activeProjectId;
  const token = leaseToken;
  if (!pid || token === null) return;
  try {
    await saveViewState(pid, useViewStore.getState().viewState, token);
  } catch (error) {
    if (error instanceof LeaseLostError) downgradeToReadOnly();
  }
}

function downgradeToReadOnly(): void {
  leaseToken = null;
  useProjectStore.getState().setReadOnly(true);
  usePersistenceStore
    .getState()
    .setStatus('readonly', '另一个标签页正在编辑该项目，本页为只读');
}

function stopHeartbeat(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

function startHeartbeat(): void {
  stopHeartbeat();
  heartbeatTimer = setInterval(() => {
    void heartbeatTick();
  }, LEASE_HEARTBEAT_MS);
}

async function heartbeatTick(): Promise<void> {
  const pid = activeProjectId;
  if (!pid || !persistenceEnabled) return;
  if (usePersistenceStore.getState().status === 'conflict') return;

  if (leaseToken === null) {
    await tryTakeover(pid);
    return;
  }
  const ok = await heartbeat(pid, tabId, leaseToken).catch(() => false);
  if (!ok) downgradeToReadOnly();
}

async function tryTakeover(pid: string): Promise<void> {
  const token = await acquireLease(pid, tabId).catch(() => null);
  if (token === null) return;
  const row = await loadProjectRow(pid);
  if (!row) return;
  await activateRow(row, token);
}

async function reloadFollowerDocument(): Promise<void> {
  const pid = activeProjectId;
  if (!pid || leaseToken !== null) return;
  const row = await loadProjectRow(pid);
  if (!row || row.docRevision <= baseRevision) return;
  suppress = true;
  useProjectStore.getState().loadProject(row.doc, true);
  const view = await loadViewState(pid).catch(() => undefined);
  useViewStore
    .getState()
    .replaceViewState(view?.viewState ?? createEmptyViewState());
  suppress = false;
  baseRevision = row.docRevision;
}

async function activateRow(row: ProjectRow, token: number | null): Promise<void> {
  stopHeartbeat();
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (viewTimer) {
    clearTimeout(viewTimer);
    viewTimer = null;
  }

  activeProjectId = row.id;
  baseRevision = row.docRevision;
  leaseToken = token;

  suppress = true;
  useProjectStore.getState().loadProject(row.doc, true);
  const view = await loadViewState(row.id).catch(() => undefined);
  useViewStore
    .getState()
    .replaceViewState(view?.viewState ?? createEmptyViewState());
  suppress = false;

  useProjectStore.getState().setReadOnly(token === null);
  const persistence = usePersistenceStore.getState();
  persistence.setProject(row.id, tabId);
  if (token === null) {
    persistence.setStatus('readonly', '另一个标签页正在编辑该项目，本页为只读');
  } else {
    persistence.markSaved(Date.now());
  }
  try {
    localStorage.setItem(LAST_PROJECT_KEY, row.id);
  } catch {
    // localStorage can be unavailable in private modes; persistence still works.
  }
  startHeartbeat();
}

function installSubscriptions(): void {
  useProjectStore.subscribe((state, previous) => {
    if (!started || activeProjectId === null) return;
    if (suppress || state.docRevision === previous.docRevision) return;
    if (state.readOnly) return;
    scheduleSave();
  });

  useViewStore.subscribe((state, previous) => {
    if (!started || activeProjectId === null) return;
    if (suppress || state.viewRevision === previous.viewRevision) return;
    scheduleViewSave();
  });
}

function setupChannel(): void {
  if (typeof BroadcastChannel === 'undefined') return;
  channel = new BroadcastChannel(CHANNEL_NAME);
  channel.onmessage = (event: MessageEvent) => {
    const data = event.data as {
      type?: string;
      projectId?: string;
      tabId?: string;
    };
    if (!data || data.type !== 'docChanged') return;
    if (data.projectId !== activeProjectId || data.tabId === tabId) return;
    if (leaseToken !== null) return;
    void reloadFollowerDocument();
  };
}

function setupUnload(): void {
  window.addEventListener('beforeunload', () => {
    if (activeProjectId && leaseToken !== null) {
      void releaseLease(activeProjectId, tabId, leaseToken).catch(() => undefined);
    }
    channel?.close();
  });
}

async function createProjectRecord(project: Project): Promise<ProjectRow> {
  const token = await acquireLease(project.id, tabId);
  if (token === null) throw new Error('无法获得项目写入权限');
  const revision = await saveDoc(project.id, project, 0, token);
  return {
    id: project.id,
    doc: project,
    docRevision: revision,
    updatedAt: Date.now(),
    schemaVersion: 1,
  };
}

async function doInit(): Promise<void> {
  tabId = getTabId();
  installSubscriptions();
  setupChannel();
  setupUnload();
  started = true;

  if (!indexedDbAvailable()) {
    persistenceEnabled = false;
    usePersistenceStore
      .getState()
      .setStatus('unavailable', '当前浏览器不支持 IndexedDB，改动不会自动保存');
    return;
  }

  try {
    await db.open();
  } catch (error) {
    persistenceEnabled = false;
    usePersistenceStore
      .getState()
      .setStatus(
        'unavailable',
        `无法打开本地数据库：${error instanceof Error ? error.message : String(error)}`,
      );
    return;
  }

  persistenceEnabled = true;
  let row: ProjectRow | undefined;
  try {
    const lastId = localStorage.getItem(LAST_PROJECT_KEY);
    row = lastId ? await loadProjectRow(lastId) : undefined;
    if (!row) {
      const rows = await listProjectRows();
      row = rows[0];
    }
  } catch {
    row = undefined;
  }

  if (!row) {
    row = await createProjectRecord(createEmptyProject('我的数值模型'));
  }

  const token = await acquireLease(row.id, tabId);
  await activateRow(row, token);
}

export function initPersistence(): Promise<void> {
  if (!initPromise) initPromise = doInit();
  return initPromise;
}

export async function createNewProject(name = '新的数值模型'): Promise<void> {
  const project = createEmptyProject(name);
  if (!persistenceEnabled) {
    activeProjectId = project.id;
    useProjectStore.getState().loadProject(project, true);
    useViewStore.getState().replaceViewState(createEmptyViewState());
    return;
  }
  const row = await createProjectRecord(project);
  await activateRow(row, await acquireLease(project.id, tabId));
}

export async function exportCurrentProject(): Promise<void> {
  const project = useProjectStore.getState().project;
  const envelope = {
    format: 'numlab',
    schemaVersion: 1,
    appVersion: '0.1.0',
    exportedAt: Date.now(),
    project,
    viewState: useViewStore.getState().viewState,
    comparisonRuns: [],
  };
  downloadJson(envelope, `iseemath-${safeFileName(project.name)}-${dateStamp()}.json`);
}

export function exportCurrentDraft(): void {
  const project = useProjectStore.getState().project;
  const envelope = {
    format: 'numlab',
    schemaVersion: 1,
    appVersion: '0.1.0',
    exportedAt: Date.now(),
    project,
    viewState: useViewStore.getState().viewState,
    comparisonRuns: [],
    draft: true,
  };
  downloadJson(envelope, `iseemath-草稿-${dateStamp()}.json`);
}

export async function importProjectFromText(text: string): Promise<void> {
  if (text.length > MAX_IMPORT_BYTES) throw new Error('文件超过 50MB 导入上限');
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('不是有效的 JSON 文件');
  }
  const envelope = raw as { project?: unknown; viewState?: ProjectViewState };
  const source = envelope.project ?? raw;
  const parsed = parseProject(source);
  const errors = validateProject(parsed);
  if (errors.length > 0) throw new Error(errors[0]);

  const imported: Project = {
    ...structuredClone(parsed),
    id: nanoid(),
    name: parsed.name,
    datasets: parsed.datasets.map((dataset) => ({
      ...dataset,
      blobKey: undefined,
      dataUnavailable: true,
    })),
    views: parsed.views.map((view) => ({
      ...view,
      status: 'broken',
      brokenReason: 'data-unavailable',
    })),
    comparisons: parsed.comparisons.map((comparison) => ({
      ...comparison,
      status: 'broken',
      brokenReason: 'data-unavailable',
    })),
    nodes: Object.fromEntries(
      Object.entries(parsed.nodes).map(([id, node]) => [
        id,
        node.kind === 'collection'
          ? { ...node, dataMissing: true }
          : node,
      ]),
    ),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  if (!persistenceEnabled) {
    activeProjectId = imported.id;
    useProjectStore.getState().loadProject(imported, true);
    useViewStore
      .getState()
      .replaceViewState(envelope.viewState ?? createEmptyViewState());
    return;
  }

  const row = await createProjectRecord(imported);
  const token = await acquireLease(imported.id, tabId);
  await activateRow(row, token);
  if (token !== null && envelope.viewState) {
    try {
      await saveViewState(imported.id, envelope.viewState, token);
    } catch {
      // View state is cosmetic; ignore failure.
    }
  }
}

export async function reloadCurrentFromStorage(): Promise<void> {
  const pid = activeProjectId;
  if (!pid) return;
  const row = await loadProjectRow(pid);
  if (!row) throw new Error('本地没有找到该项目');
  await activateRow(row, leaseToken);
  try {
    await deleteDraft(pid, tabId);
  } catch {
    // ignore
  }
  usePersistenceStore.getState().setDraftAvailable(false);
}

export async function listProjects(): Promise<{ id: string; name: string; updatedAt: number }[]> {
  if (!persistenceEnabled) return [];
  const rows = await listProjectRows();
  return rows.map((row) => ({
    id: row.id,
    name: row.doc.name,
    updatedAt: row.updatedAt,
  }));
}

export async function openProject(projectId: string): Promise<void> {
  const row = await loadProjectRow(projectId);
  if (!row) throw new Error('项目不存在');
  const token = await acquireLease(projectId, tabId);
  await activateRow(row, token);
}

function downloadJson(value: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(value, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function safeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 60) || 'project';
}

function dateStamp(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(
    now.getHours(),
  )}${pad(now.getMinutes())}`;
}
