import { describe, expect, it } from 'vitest';
import {
  addCollectionField,
  addCollectionNode,
  addInfluence,
  createBundle,
  deleteInfluence,
  deleteNode,
  markDatasetUnavailable,
  removeCollectionField,
  removeDataset,
  setCollectionDataset,
  updateNode,
  setNodeParent,
  updateCollectionField,
} from './commands';
import {
  createCollectionNode,
  createEmptyProject,
  createGroupNode,
  createVariableNode,
} from './factories';
import type { AnalysisView, DatasetMeta, Project } from './types';

function node(project: Project, name: string) {
  const found = Object.values(project.nodes).find((item) => item.name === name);
  if (!found) throw new Error(`missing node ${name}`);
  return found;
}

describe('influence relations', () => {
  it('creates and deletes an influence edge without touching computation', () => {
    const project = createEmptyProject();
    const a = createVariableNode('A', { x: 0, y: 0 }, { value: 1 });
    const b = createVariableNode('B', { x: 0, y: 100 }, { value: 2 });
    project.nodes[a.id] = a;
    project.nodes[b.id] = b;

    const relation = addInfluence(project, a.id, b.id);
    expect(project.relations).toHaveLength(1);
    expect(relation.kind).toBe('influence');

    deleteInfluence(project, relation.id);
    expect(project.relations).toHaveLength(0);
  });

  it('rejects self links and duplicate influence edges', () => {
    const project = createEmptyProject();
    const a = createVariableNode('A', { x: 0, y: 0 }, { value: 1 });
    const b = createVariableNode('B', { x: 0, y: 100 }, { value: 2 });
    project.nodes[a.id] = a;
    project.nodes[b.id] = b;

    expect(() => addInfluence(project, a.id, a.id)).toThrow('不能连接自身');
    addInfluence(project, a.id, b.id);
    expect(() => addInfluence(project, a.id, b.id)).toThrow('影响关系已存在');
  });
});

describe('deleteNode', () => {
  it('promotes only direct children and keeps deeper levels intact', () => {
    const project = createEmptyProject();
    const root = createGroupNode('根', { x: 0, y: 0 });
    const child = createGroupNode('子', { x: 0, y: 100 });
    const grandchild = createVariableNode('孙', { x: 0, y: 200 });
    project.nodes[root.id] = root;
    project.nodes[child.id] = child;
    project.nodes[grandchild.id] = grandchild;
    child.parentId = root.id;
    grandchild.parentId = child.id;

    deleteNode(project, root.id);

    expect(project.nodes[root.id]).toBeUndefined();
    expect(project.nodes[child.id]!.parentId).toBeNull();
    expect(project.nodes[grandchild.id]!.parentId).toBe(child.id);
  });

  it('cleans influence edges, bundle membership and scenario overrides', () => {
    const project = createEmptyProject();
    const a = createVariableNode('A', { x: 0, y: 0 }, { value: 1 });
    const b = createVariableNode('B', { x: 0, y: 100 }, { value: 2 });
    project.nodes[a.id] = a;
    project.nodes[b.id] = b;
    addInfluence(project, a.id, b.id);
    const bundle = createBundle(project, '包', [a.id, b.id]);
    bundle.summary = { mode: 'member', memberId: a.id };
    project.scenarios = [{ id: 's1', name: '场景', overrides: { [a.id]: 10 } }];

    deleteNode(project, a.id);

    expect(project.relations).toHaveLength(0);
    expect(project.scenarios[0]!.overrides[a.id]).toBeUndefined();
    expect(bundle.memberIds).not.toContain(a.id);
    expect(bundle.summary.mode).toBe('none');
    expect(bundle.summary.memberId).toBeUndefined();
  });
});

function makeDataset(id: string): DatasetMeta {
  return {
    id,
    name: id,
    format: 'csv',
    storage: 'blob',
    blobKey: `p:${id}`,
    parserVersion: '1',
    rawBytesHash: 'raw',
    parseParamsHash: 'params',
    contentHash: 'content',
    outputDigest: 'digest',
    columns: [{ id: 'c0', name: '伤害', type: 'number', sourceIndex: 0 }],
    rowCount: 1,
    datasetHash: 'hash',
    createdAt: 1,
  };
}

function makeView(id: string, datasetId: string): AnalysisView {
  return {
    id,
    name: id,
    datasetId,
    filters: [],
    groupBy: ['c0'],
    metrics: [{ id: 'm1', op: 'count', alias: '行数' }],
    schemaHash: 'schema',
    status: 'active',
    createdAt: 1,
    updatedAt: 1,
  };
}

describe('dataset lifecycle', () => {
  it('removes a dataset and breaks only the views referencing it', () => {
    const project = createEmptyProject();
    const first = makeDataset('ds1');
    const second = makeDataset('ds2');
    project.datasets.push(first, second);
    project.views.push(makeView('v1', 'ds1'), makeView('v2', 'ds2'), makeView('v3', 'ds1'));
    project.views[2]!.status = 'broken';
    project.views[2]!.brokenReason = '旧问题';

    removeDataset(project, 'ds1');

    expect(project.datasets.map((dataset) => dataset.id)).toEqual(['ds2']);
    expect(project.views[0]!.status).toBe('broken');
    expect(project.views[0]!.brokenReason).toBe('数据集已删除');
    expect(project.views[1]!.status).toBe('active');
    // Broken views keep their original reason instead of being rewritten.
    expect(project.views[2]!.brokenReason).toBe('旧问题');
  });

  it('rejects removing an unknown dataset', () => {
    const project = createEmptyProject();
    expect(() => removeDataset(project, 'missing')).toThrow('数据集不存在');
  });

  it('marks a dataset unavailable and breaks its views once', () => {
    const project = createEmptyProject();
    project.datasets.push(makeDataset('ds1'));
    project.views.push(makeView('v1', 'ds1'));

    markDatasetUnavailable(project, 'ds1', '原始文件缺失');
    expect(project.datasets[0]!.dataUnavailable).toBe(true);
    expect(project.views[0]!.status).toBe('broken');
    expect(project.views[0]!.brokenReason).toBe('原始文件缺失');

    markDatasetUnavailable(project, 'ds1', 'again');
    expect(project.views[0]!.brokenReason).toBe('原始文件缺失');
  });
});

describe('setNodeParent', () => {
  it('rejects hierarchy cycles', () => {
    const project = createEmptyProject();
    const parent = createGroupNode('父', { x: 0, y: 0 });
    const child = createGroupNode('子', { x: 0, y: 100 });
    project.nodes[parent.id] = parent;
    project.nodes[child.id] = child;
    child.parentId = parent.id;

    expect(() => setNodeParent(project, parent.id, child.id)).toThrow('归属层级不能成环');
    expect(node(project, '父').parentId).toBeNull();
  });
});

describe('collection commands', () => {
  it('binds a collection to an existing dataset and validates input columns', () => {
    const project = createEmptyProject();
    project.datasets.push(makeDataset('ds1'));
    const node = createCollectionNode('怪物', { x: 0, y: 0 }, 'ds1', [
      { id: 'f1', name: '伤害', label: '伤害', type: 'number', role: 'input', sourceColumnId: 'c0' },
      { id: 'f2', name: '缺失', label: '缺失', type: 'number', role: 'input', sourceColumnId: 'c-missing' },
    ]);
    addCollectionNode(project, node);
    expect(node.fields[0]!.missing).toBeFalsy();
    expect(node.fields[1]!.missing).toBe(true);
    expect(node.dataMissing).toBe(true);

    expect(() =>
      addCollectionNode(createEmptyProject(), createCollectionNode('x', { x: 0, y: 0 }, 'nope')),
    ).toThrow('绑定的数据集不存在');
  });

  it('rejects field names colliding with globals, builtins or siblings', () => {
    const project = createEmptyProject();
    project.datasets.push(makeDataset('ds1'));
    const attack = createVariableNode('攻击力', { x: 0, y: 0 }, { value: 10 });
    project.nodes[attack.id] = attack;
    const node = createCollectionNode('怪物', { x: 0, y: 0 }, 'ds1');
    addCollectionNode(project, node);

    const base = { label: '', type: 'number' as const, role: 'derived' as const, formula: '1' };
    expect(() => addCollectionField(project, node.id, { id: 'f1', name: '攻击力', ...base })).toThrow('冲突');
    expect(() => addCollectionField(project, node.id, { id: 'f2', name: 'round', ...base })).toThrow('内置');
    addCollectionField(project, node.id, { id: 'f3', name: '伤害', ...base });
    expect(() => addCollectionField(project, node.id, { id: 'f4', name: '伤害', ...base })).toThrow('已存在');
    expect(() =>
      addCollectionField(project, node.id, { id: 'f5', name: '文本', ...base, type: 'string' }),
    ).toThrow('派生列只能输出数值');
  });

  it('updates and removes fields while bumping dataRevision', () => {
    const project = createEmptyProject();
    project.datasets.push(makeDataset('ds1'));
    const node = createCollectionNode('怪物', { x: 0, y: 0 }, 'ds1', [
      { id: 'f1', name: '伤害', label: '伤害', type: 'number', role: 'input', sourceColumnId: 'c0' },
    ]);
    addCollectionNode(project, node);
    const revision = node.dataRevision;

    updateCollectionField(project, node.id, 'f1', { label: '实际伤害', formula: '伤害 * 2', role: 'derived' });
    expect(node.dataRevision).toBe(revision + 1);
    expect(node.fields[0]!.label).toBe('实际伤害');
    expect(() => updateCollectionField(project, node.id, 'f1', { name: 'round' })).toThrow('内置');

    removeCollectionField(project, node.id, 'f1');
    expect(node.fields).toHaveLength(0);
  });

  it('rebinding a dataset revalidates fields and bumps dataRevision', () => {
    const project = createEmptyProject();
    project.datasets.push(makeDataset('ds1'));
    const other: DatasetMeta = {
      ...makeDataset('ds2'),
      columns: [{ id: 'x0', name: 'other', type: 'number', sourceIndex: 0 }],
    };
    project.datasets.push(other);
    const node = createCollectionNode('怪物', { x: 0, y: 0 }, 'ds1', [
      { id: 'f1', name: '伤害', label: '伤害', type: 'number', role: 'input', sourceColumnId: 'c0' },
    ]);
    addCollectionNode(project, node);
    const revision = node.dataRevision;

    setCollectionDataset(project, node.id, 'ds2');
    expect(node.dataRevision).toBe(revision + 1);
    expect(node.fields[0]!.missing).toBe(true);
    expect(node.dataMissing).toBe(true);

    setCollectionDataset(project, node.id, 'ds1');
    expect(node.fields[0]!.missing).toBe(false);
    expect(node.dataMissing).toBe(false);
    expect(() => setCollectionDataset(project, node.id, 'nope')).toThrow('数据集不存在');
  });

  it('allows a derived field to switch to a textual input column', () => {
    const project = createEmptyProject();
    project.datasets.push(makeDataset('ds1'));
    const node = createCollectionNode('怪物', { x: 0, y: 0 }, 'ds1', [
      { id: 'f1', name: '评分', label: '评分', type: 'number', role: 'derived', formula: '1' },
    ]);
    addCollectionNode(project, node);

    updateCollectionField(project, node.id, 'f1', {
      role: 'input',
      type: 'string',
      sourceColumnId: 'c0',
      formula: undefined,
    });
    expect(node.fields[0]!.role).toBe('input');
    expect(node.fields[0]!.type).toBe('string');
    // The mapped column is numeric, so the field is now marked missing.
    expect(node.fields[0]!.missing).toBe(true);
    expect(node.dataMissing).toBe(true);
  });

  it('rejects renaming a variable to a collection field name', () => {
    const project = createEmptyProject();
    project.datasets.push(makeDataset('ds1'));
    const variable = createVariableNode('攻击力', { x: 0, y: 0 }, { value: 1 });
    project.nodes[variable.id] = variable;
    const node = createCollectionNode('怪物', { x: 0, y: 0 }, 'ds1', [
      { id: 'f1', name: '伤害', label: '伤害', type: 'number', role: 'input', sourceColumnId: 'c0' },
    ]);
    addCollectionNode(project, node);

    expect(() => updateNode(project, variable.id, { name: '伤害' })).toThrow('字段冲突');
    expect(project.nodes[variable.id]!.name).toBe('攻击力');
  });

  it('removing a dataset marks bound collections as data-missing', () => {
    const project = createEmptyProject();
    project.datasets.push(makeDataset('ds1'));
    const node = createCollectionNode('怪物', { x: 0, y: 0 }, 'ds1', [
      { id: 'f1', name: '伤害', label: '伤害', type: 'number', role: 'input', sourceColumnId: 'c0' },
    ]);
    addCollectionNode(project, node);

    removeDataset(project, 'ds1');
    expect(node.dataMissing).toBe(true);
    expect(node.fields[0]!.missing).toBe(true);
  });
});

describe('renameVariableReferences', () => {
  it('rewrites formulas and derived fields but leaves local bindings alone', () => {
    const project = createEmptyProject();
    project.datasets.push(makeDataset('ds1'));

    const attack = createVariableNode('攻击力', { x: 0, y: 0 }, { value: 100 });
    const damage = createVariableNode('伤害', { x: 0, y: 100 }, {
      variableKind: 'formula',
      role: 'intermediate',
      formula: '攻击力 * 2',
    });
    const shadowed = createVariableNode('局部', { x: 0, y: 200 }, {
      variableKind: 'formula',
      role: 'intermediate',
      formula: 'let 攻击力 = 1; 攻击力 + 5',
    });
    project.nodes[attack.id] = attack;
    project.nodes[damage.id] = damage;
    project.nodes[shadowed.id] = shadowed;

    const collection = createCollectionNode('怪物', { x: 0, y: 300 }, 'ds1', [
      { id: 'f1', name: 'HP', label: 'HP', type: 'number', role: 'input', sourceColumnId: 'c0' },
      {
        id: 'f2',
        name: 'Power',
        label: 'Power',
        type: 'number',
        role: 'derived',
        formula: 'HP * 攻击力',
      },
    ]);
    addCollectionNode(project, collection);

    updateNode(project, attack.id, { name: '基础攻击力' });

    expect(project.nodes[attack.id]!.name).toBe('基础攻击力');
    expect(damage.formula).toBe('基础攻击力 * 2');
    expect(shadowed.formula).toBe('let 攻击力 = 1; 攻击力 + 5');
    expect(collection.fields[1]!.formula).toBe('HP * 基础攻击力');
  });

  it('preserves formulas that cannot be parsed', () => {
    const project = createEmptyProject();
    const attack = createVariableNode('攻击力', { x: 0, y: 0 }, { value: 1 });
    const broken = createVariableNode('损坏', { x: 0, y: 100 }, {
      variableKind: 'formula',
      role: 'intermediate',
      formula: '攻击力 +',
    });
    project.nodes[attack.id] = attack;
    project.nodes[broken.id] = broken;

    updateNode(project, attack.id, { name: '基础攻击力' });

    expect(broken.formula).toBe('攻击力 +');
  });
});
