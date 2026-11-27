import { create } from 'zustand';
import { applyPatches, enablePatches, produce, produceWithPatches, type Patch } from 'immer';
import { createEmptyProject } from '@/core/model/factories';
import { stableStringify } from '@/core/eval/hash';
import type { Project } from '@/core/model/types';

enablePatches();

export type PatchPath = readonly (string | number)[];

interface PostImage {
  path: PatchPath;
  value: unknown;
}

export interface UndoEntry {
  id: string;
  label: string;
  forward: Patch[];
  inverse: Patch[];
  postImages: PostImage[];
  timestamp: number;
  datasetIds: string[];
  blobKeys: string[];
}

export interface CommandOptions {
  /** System writes bypass undo history and clear redo. */
  system?: boolean;
  datasetIds?: string[];
  blobKeys?: string[];
}

export interface ProjectStore {
  project: Project;
  docRevision: number;
  undoStack: UndoEntry[];
  redoStack: UndoEntry[];
  lastRejectedUndo: string | null;
  /** True while another tab holds the write lease. */
  readOnly: boolean;
  runCommand: (label: string, recipe: (draft: Project) => void, options?: CommandOptions) => void;
  undo: () => void;
  redo: () => void;
  loadProject: (project: Project, resetHistory?: boolean) => void;
  clearHistory: () => void;
  setReadOnly: (readOnly: boolean) => void;
}

let entrySequence = 0;

function nextEntryId(): string {
  entrySequence += 1;
  return `u${entrySequence}`;
}

function cloneValue(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== 'object') return value;
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch {
      return JSON.parse(JSON.stringify(value)) as unknown;
    }
  }
  return JSON.parse(JSON.stringify(value)) as unknown;
}

function getAtPath(root: unknown, path: PatchPath): unknown {
  let cursor: unknown = root;
  for (const key of path) {
    if (cursor === null || cursor === undefined) return undefined;
    cursor = (cursor as Record<string | number, unknown>)[key];
  }
  return cursor;
}

function pathsIntersect(a: PatchPath, b: PatchPath): boolean {
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function entryTouchesPaths(entry: UndoEntry, paths: PatchPath[]): boolean {
  for (const patch of [...entry.forward, ...entry.inverse]) {
    for (const path of paths) {
      if (pathsIntersect(patch.path as PatchPath, path)) return true;
    }
  }
  return false;
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (typeof a === 'object' && typeof b === 'object') {
    return stableStringify(a) === stableStringify(b);
  }
  return false;
}

const MAX_HISTORY = 100;

export const useProjectStore = create<ProjectStore>((set, get) => ({
  project: createEmptyProject('我的数值模型'),
  docRevision: 1,
  undoStack: [],
  redoStack: [],
  lastRejectedUndo: null,
  readOnly: false,

  runCommand(label, recipe, options = {}) {
    if (get().readOnly) {
      set({ lastRejectedUndo: '当前标签页为只读，另一个标签页正在编辑该项目' });
      return;
    }
    const { project, undoStack } = get();
    const [next, patches, inversePatches] = produceWithPatches(project, recipe);
    if (patches.length === 0) return;

    if (options.system) {
      const systemPaths = patches.map((patch) => patch.path as PatchPath);
      const survivors = undoStack.filter((entry) => !entryTouchesPaths(entry, systemPaths));
      set((state) => ({
        project: next,
        docRevision: state.docRevision + 1,
        undoStack: survivors,
        redoStack: [],
        lastRejectedUndo: null,
      }));
      return;
    }

    const postImages: PostImage[] = patches.map((patch) => ({
      path: patch.path as PatchPath,
      value: cloneValue(getAtPath(next, patch.path)),
    }));

    const entry: UndoEntry = {
      id: nextEntryId(),
      label,
      forward: patches,
      inverse: inversePatches,
      postImages,
      timestamp: Date.now(),
      datasetIds: options.datasetIds ?? [],
      blobKeys: options.blobKeys ?? [],
    };

    set((state) => ({
      project: next,
      docRevision: state.docRevision + 1,
      undoStack: [...state.undoStack, entry].slice(-MAX_HISTORY),
      redoStack: [],
      lastRejectedUndo: null,
    }));
  },

  undo() {
    if (get().readOnly) return;
    const { project, undoStack } = get();
    const entry = undoStack[undoStack.length - 1];
    if (!entry) return;

    const stillMatches = entry.postImages.every((postImage) =>
      valuesEqual(getAtPath(project, postImage.path), postImage.value),
    );
    if (!stillMatches) {
      set({
        undoStack: [],
        redoStack: [],
        lastRejectedUndo: '数据已更新，撤销历史已重置',
      });
      return;
    }

    const next = applyPatches(project, entry.inverse);
    set((state) => ({
      project: next,
      docRevision: state.docRevision + 1,
      undoStack: state.undoStack.slice(0, -1),
      redoStack: [...state.redoStack, entry],
      lastRejectedUndo: null,
    }));
  },

  redo() {
    if (get().readOnly) return;
    const { project, redoStack } = get();
    const entry = redoStack[redoStack.length - 1];
    if (!entry) return;
    const next = applyPatches(project, entry.forward);
    set((state) => ({
      project: next,
      docRevision: state.docRevision + 1,
      undoStack: [...state.undoStack, entry],
      redoStack: state.redoStack.slice(0, -1),
      lastRejectedUndo: null,
    }));
  },

  loadProject(project, resetHistory = true) {
    set((state) => ({
      project,
      docRevision: state.docRevision + 1,
      undoStack: resetHistory ? [] : state.undoStack,
      redoStack: resetHistory ? [] : state.redoStack,
      lastRejectedUndo: null,
    }));
  },

  clearHistory() {
    set({ undoStack: [], redoStack: [], lastRejectedUndo: null });
  },

  setReadOnly(readOnly) {
    set({ readOnly });
  },
}));

/** Apply a system-only mutation without producing undo history. */
export function applySystemMutation(recipe: (draft: Project) => void): void {
  const { project } = useProjectStore.getState();
  const next = produce(project, recipe);
  useProjectStore.setState({ project: next, docRevision: useProjectStore.getState().docRevision + 1 });
}
