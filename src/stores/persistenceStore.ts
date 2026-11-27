import { create } from 'zustand';

export type PersistenceStatus =
  | 'loading'
  | 'saved'
  | 'saving'
  | 'readonly'
  | 'conflict'
  | 'error'
  | 'unavailable';

export interface PersistenceStore {
  status: PersistenceStatus;
  message?: string;
  projectId?: string;
  tabId?: string;
  lastSavedAt?: number;
  /** True when a local draft was stored because of a save conflict. */
  draftAvailable: boolean;
  setStatus: (status: PersistenceStatus, message?: string) => void;
  setProject: (projectId: string, tabId: string) => void;
  markSaved: (at: number) => void;
  setDraftAvailable: (available: boolean) => void;
}

export const usePersistenceStore = create<PersistenceStore>((set) => ({
  status: 'loading',
  draftAvailable: false,

  setStatus(status, message) {
    set({ status, message });
  },

  setProject(projectId, tabId) {
    set({ projectId, tabId });
  },

  markSaved(at) {
    set({ status: 'saved', message: undefined, lastSavedAt: at, draftAvailable: false });
  },

  setDraftAvailable(draftAvailable) {
    set({ draftAvailable });
  },
}));
