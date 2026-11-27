import { beforeEach, describe, expect, it } from 'vitest';
import { useUiStore } from './uiStore';

beforeEach(() => {
  useUiStore.setState({ selectedNodeIds: [], selectedBundleId: null });
});

describe('uiStore selection', () => {
  it('clearing the bundle selection keeps node multi-selection intact', () => {
    useUiStore.setState({ selectedNodeIds: ['a', 'b'], selectedBundleId: 'pack' });
    useUiStore.getState().selectBundle(null);
    expect(useUiStore.getState().selectedBundleId).toBeNull();
    expect(useUiStore.getState().selectedNodeIds).toEqual(['a', 'b']);
  });

  it('selecting a bundle clears node selection', () => {
    useUiStore.setState({ selectedNodeIds: ['a'], selectedBundleId: null });
    useUiStore.getState().selectBundle('pack');
    expect(useUiStore.getState().selectedBundleId).toBe('pack');
    expect(useUiStore.getState().selectedNodeIds).toEqual([]);
  });

  it('additive toggle adds and removes without replacing the selection', () => {
    useUiStore.getState().selectNodes(['a']);
    useUiStore.getState().toggleSelected('b', true);
    expect(useUiStore.getState().selectedNodeIds).toEqual(['a', 'b']);
    useUiStore.getState().toggleSelected('a', true);
    expect(useUiStore.getState().selectedNodeIds).toEqual(['b']);
    useUiStore.getState().toggleSelected('c');
    expect(useUiStore.getState().selectedNodeIds).toEqual(['c']);
  });
});
