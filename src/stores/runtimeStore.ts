import { create } from 'zustand';
import type { NodeId } from '@/core/model/types';

export type RebuildState = 'idle' | 'pending' | 'rebuilding' | 'error';

export interface DatasetRuntime {
  blobPresent: boolean;
  rowsLoaded: boolean;
  loadedDatasetHash?: string;
  rebuildState: RebuildState;
  rebuildJobToken?: string;
  integrityError?: string;
  progress?: number;
  error?: string;
  /** Set when parse settings changed, so the next adoption is not called drift. */
  expectOutputChange?: boolean;
  /** Same bytes + parser but a different output digest: non-determinism or a changed file. */
  driftWarning?: string;
}

export interface ReplaceState {
  datasetId: string;
  jobToken: string;
  newBlobKey: string;
  phase: 'parsing';
  baseDocRevision: number;
  baseMetaHash: string;
}

export interface RuntimeStore {
  values: Record<NodeId, number | undefined>;
  errors: Record<NodeId, string | undefined>;
  evalHash: string;
  evaluating: boolean;
  datasetRuntime: Record<string, DatasetRuntime>;
  replaceState?: ReplaceState;
  publishEvaluation: (
    evalHash: string,
    values: Record<NodeId, number | undefined>,
    errors: Record<NodeId, string | undefined>,
  ) => void;
  setEvaluating: (evaluating: boolean) => void;
  setDatasetRuntime: (datasetId: string, runtime: DatasetRuntime) => void;
  removeDatasetRuntime: (datasetId: string) => void;
  setReplaceState: (replaceState?: ReplaceState) => void;
}

export const useRuntimeStore = create<RuntimeStore>((set) => ({
  values: {},
  errors: {},
  evalHash: '',
  evaluating: false,
  datasetRuntime: {},

  publishEvaluation(evalHash, values, errors) {
    set({ evalHash, values, errors, evaluating: false });
  },

  setEvaluating(evaluating) {
    set({ evaluating });
  },

  setDatasetRuntime(datasetId, runtime) {
    set((state) => ({
      datasetRuntime: { ...state.datasetRuntime, [datasetId]: runtime },
    }));
  },

  removeDatasetRuntime(datasetId) {
    set((state) => {
      if (!(datasetId in state.datasetRuntime)) return {};
      const next = { ...state.datasetRuntime };
      delete next[datasetId];
      return { datasetRuntime: next };
    });
  },

  setReplaceState(replaceState) {
    set({ replaceState });
  },
}));
