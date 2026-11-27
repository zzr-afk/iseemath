import { create } from 'zustand';
import type { NodeId, ProjectViewState } from '@/core/model/types';

export interface ViewStore {
  viewState: ProjectViewState;
  viewRevision: number;
  toggleBundle: (bundleId: string) => void;
  setBundleCollapsed: (bundleId: string, collapsed: boolean) => void;
  toggleGroup: (nodeId: NodeId) => void;
  setViewport: (viewport: { x: number; y: number; zoom: number }) => void;
  setNodeSizes: (sizes: Record<NodeId, { width: number; height: number }>) => void;
  replaceViewState: (viewState: ProjectViewState) => void;
}

export function createEmptyViewState(): ProjectViewState {
  return {
    schemaVersion: 1,
    bundleCollapsed: {},
    groupCollapsed: {},
    nodeSizes: {},
  };
}

export const useViewStore = create<ViewStore>((set) => ({
  viewState: createEmptyViewState(),
  viewRevision: 1,

  toggleBundle(bundleId) {
    set((state) => ({
      viewRevision: state.viewRevision + 1,
      viewState: {
        ...state.viewState,
        bundleCollapsed: {
          ...state.viewState.bundleCollapsed,
          [bundleId]: !state.viewState.bundleCollapsed[bundleId],
        },
      },
    }));
  },

  setBundleCollapsed(bundleId, collapsed) {
    set((state) => ({
      viewRevision: state.viewRevision + 1,
      viewState: {
        ...state.viewState,
        bundleCollapsed: { ...state.viewState.bundleCollapsed, [bundleId]: collapsed },
      },
    }));
  },

  toggleGroup(nodeId) {
    set((state) => ({
      viewRevision: state.viewRevision + 1,
      viewState: {
        ...state.viewState,
        groupCollapsed: {
          ...state.viewState.groupCollapsed,
          [nodeId]: !state.viewState.groupCollapsed[nodeId],
        },
      },
    }));
  },

  setViewport(viewport) {
    set((state) => ({
      viewRevision: state.viewRevision + 1,
      viewState: { ...state.viewState, viewport },
    }));
  },

  setNodeSizes(sizes) {
    set((state) => ({
      viewRevision: state.viewRevision + 1,
      viewState: { ...state.viewState, nodeSizes: { ...state.viewState.nodeSizes, ...sizes } },
    }));
  },

  replaceViewState(viewState) {
    set((state) => ({ viewState, viewRevision: state.viewRevision + 1 }));
  },
}));
