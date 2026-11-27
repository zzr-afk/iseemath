import { create } from 'zustand';
import type { NodeId } from '@/core/model/types';

export type EdgeFilter = 'all' | 'hierarchy' | 'dependency' | 'influence';
export type WorkspaceTab = 'canvas' | 'data' | 'relations' | 'logs' | 'compare';

export interface UiStore {
  selectedNodeIds: NodeId[];
  selectedBundleId: string | null;
  activeTab: WorkspaceTab;
  edgeFilter: EdgeFilter;
  inspectorOpen: boolean;
  /** Relation row to highlight/scroll to; the nonce retriggers scrolling. */
  focusedRelationId: NodeId | null;
  relationFocusNonce: number;
  layoutRevision: number;
  /** Collection node whose data grid is open in the modal editor. */
  editingCollectionId: NodeId | null;
  selectNodes: (ids: NodeId[]) => void;
  selectBundle: (bundleId: string | null) => void;
  toggleSelected: (id: NodeId, additive?: boolean) => void;
  setActiveTab: (tab: WorkspaceTab) => void;
  setEdgeFilter: (filter: EdgeFilter) => void;
  setEditingCollectionId: (id: NodeId | null) => void;
  focusRelation: (nodeId: NodeId) => void;
  clearFocusedRelation: () => void;
  bumpLayout: () => void;
}

export const useUiStore = create<UiStore>((set) => ({
  selectedNodeIds: [],
  selectedBundleId: null,
  activeTab: 'canvas',
  edgeFilter: 'all',
  inspectorOpen: true,
  focusedRelationId: null,
  relationFocusNonce: 0,
  layoutRevision: 1,
  editingCollectionId: null,

  selectNodes(ids) {
    set({ selectedNodeIds: ids, selectedBundleId: null });
  },

  selectBundle(selectedBundleId) {
    // Passing null only clears the bundle selection; callers such as the
    // variable tree rely on the node selection surviving when they clear it
    // before an additive selection.
    if (selectedBundleId === null) {
      set({ selectedBundleId: null });
      return;
    }
    set({ selectedBundleId, selectedNodeIds: [] });
  },

  toggleSelected(id, additive = false) {
    set((state) => {
      if (!additive) return { selectedNodeIds: [id] };
      const exists = state.selectedNodeIds.includes(id);
      return {
        selectedNodeIds: exists
          ? state.selectedNodeIds.filter((item) => item !== id)
          : [...state.selectedNodeIds, id],
      };
    });
  },

  setActiveTab(activeTab) {
    set({ activeTab });
  },

  setEdgeFilter(edgeFilter) {
    set({ edgeFilter });
  },

  setEditingCollectionId(editingCollectionId) {
    set({ editingCollectionId });
  },

  focusRelation(nodeId) {
    // Formulas live in the relations workspace now, so focusing a row also
    // switches to it — otherwise clicking an arrow on the canvas would appear
    // to do nothing.
    set((state) => ({
      focusedRelationId: nodeId,
      relationFocusNonce: state.relationFocusNonce + 1,
      activeTab: 'relations',
    }));
  },

  clearFocusedRelation() {
    set({ focusedRelationId: null });
  },

  bumpLayout() {
    set((state) => ({ layoutRevision: state.layoutRevision + 1 }));
  },
}));
