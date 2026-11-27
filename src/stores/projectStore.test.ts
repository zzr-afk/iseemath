import { beforeEach, describe, expect, it } from 'vitest';
import { useProjectStore } from './projectStore';
import { createEmptyProject, createVariableNode } from '@/core/model/factories';
import { moveNodes } from '@/core/model/commands';

beforeEach(() => {
  useProjectStore.getState().loadProject(createEmptyProject('测试'));
  useProjectStore.getState().clearHistory();
});

describe('projectStore patch undo', () => {
  it('undoes and redoes a single command', () => {
    const store = useProjectStore.getState();
    const node = createVariableNode('攻击力', { x: 0, y: 0 }, { value: 10 });

    store.runCommand('新建变量', (draft) => {
      draft.nodes[node.id] = node;
    });

    expect(Object.keys(useProjectStore.getState().project.nodes)).toHaveLength(1);
    expect(useProjectStore.getState().undoStack).toHaveLength(1);

    useProjectStore.getState().undo();
    expect(Object.keys(useProjectStore.getState().project.nodes)).toHaveLength(0);

    useProjectStore.getState().redo();
    expect(useProjectStore.getState().project.nodes[node.id]).toBeDefined();
  });

  it('records only one history entry for a multi-node drag', () => {
    const store = useProjectStore.getState();
    const first = createVariableNode('A', { x: 0, y: 0 }, { value: 1 });
    const second = createVariableNode('B', { x: 0, y: 100 }, { value: 2 });
    store.runCommand('新建变量', (draft) => {
      draft.nodes[first.id] = first;
      draft.nodes[second.id] = second;
    });
    useProjectStore.getState().clearHistory();

    useProjectStore.getState().runCommand('移动节点', (draft) =>
      moveNodes(draft, {
        [first.id]: { x: 10, y: 10 },
        [second.id]: { x: 20, y: 20 },
      }),
    );
    expect(useProjectStore.getState().undoStack).toHaveLength(1);

    useProjectStore.getState().undo();
    const nodes = useProjectStore.getState().project.nodes;
    expect(nodes[first.id]!.position).toEqual({ x: 0, y: 0 });
    expect(nodes[second.id]!.position).toEqual({ x: 0, y: 100 });
  });

  it('system writes clear redo without adding history', () => {
    const store = useProjectStore.getState();
    const node = createVariableNode('A', { x: 0, y: 0 }, { value: 1 });
    store.runCommand('新建变量', (draft) => {
      draft.nodes[node.id] = node;
    });
    useProjectStore.getState().undo();
    expect(useProjectStore.getState().redoStack).toHaveLength(1);

    useProjectStore.getState().runCommand(
      '系统写入',
      (draft) => {
        draft.updatedAt = 12345;
      },
      { system: true },
    );

    expect(useProjectStore.getState().redoStack).toHaveLength(0);
    expect(useProjectStore.getState().undoStack).toHaveLength(0);
  });

  it('drops history entries that intersect a system write', () => {
    const store = useProjectStore.getState();
    const node = createVariableNode('A', { x: 0, y: 0 }, { value: 1 });
    store.runCommand('新建变量', (draft) => {
      draft.nodes[node.id] = node;
    });

    useProjectStore.getState().runCommand(
      '系统覆盖',
      (draft) => {
        const current = draft.nodes[node.id];
        if (current) current.position = { x: 999, y: 999 };
      },
      { system: true },
    );

    const state = useProjectStore.getState();
    expect(state.undoStack).toHaveLength(0);
    expect(state.project.nodes[node.id]!.position).toEqual({ x: 999, y: 999 });
    state.undo();
    expect(useProjectStore.getState().project.nodes[node.id]!.position).toEqual({ x: 999, y: 999 });
  });
});
