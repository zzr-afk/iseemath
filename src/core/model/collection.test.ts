import { describe, expect, it } from 'vitest';
import { createEmptyProject, createVariableNode } from './factories';
import {
  analyzeCollectionFields,
  collectionBindingIssue,
  findFieldConflictForVariable,
  findFieldNameConflict,
  revalidateCollectionFields,
} from './collection';
import type { CollectionNode, DatasetMeta, FieldDef } from './types';

function makeDataset(overrides: Partial<DatasetMeta> = {}): DatasetMeta {
  return {
    id: 'ds1',
    name: '怪物数据',
    format: 'csv',
    storage: 'blob',
    blobKey: 'p:b',
    encoding: 'utf-8',
    delimiter: ',',
    parserVersion: '1',
    rawBytesHash: 'raw',
    parseParamsHash: 'params',
    contentHash: 'content',
    outputDigest: 'digest',
    datasetHash: 'hash',
    columns: [
      { id: 'c0', name: 'HP', type: 'number', sourceIndex: 0 },
      { id: 'c1', name: 'ATK', type: 'number', sourceIndex: 1 },
      { id: 'c2', name: 'Server', type: 'string', sourceIndex: 2 },
    ],
    rowCount: 3,
    createdAt: 0,
    ...overrides,
  };
}

function makeCollection(projectId = 'c1'): CollectionNode {
  const fields: FieldDef[] = [
    { id: 'f-hp', name: 'HP', label: 'HP', type: 'number', role: 'input', sourceColumnId: 'c0' },
    { id: 'f-atk', name: 'ATK', label: 'ATK', type: 'number', role: 'input', sourceColumnId: 'c1' },
    { id: 'f-power', name: 'Power', label: 'Power', type: 'number', role: 'derived', formula: 'HP * ATK' },
  ];
  return {
    id: projectId,
    kind: 'collection',
    name: '怪物',
    label: '怪物',
    tags: [],
    parentId: null,
    position: { x: 0, y: 0 },
    createdAt: 0,
    updatedAt: 0,
    datasetId: 'ds1',
    fields,
    dataRevision: 0,
  };
}

describe('collection field validation', () => {
  it('marks missing columns and clears them when the schema recovers', () => {
    const project = createEmptyProject('测试');
    const dataset = makeDataset();
    project.datasets.push(dataset);
    const node = makeCollection();
    project.nodes[node.id] = node;

    dataset.columns = dataset.columns.filter((column) => column.id !== 'c1');
    expect(revalidateCollectionFields(project, 'ds1')).toBe(true);
    expect(node.fields[1]!.missing).toBe(true);
    expect(node.dataMissing).toBe(true);

    dataset.columns = makeDataset().columns;
    expect(revalidateCollectionFields(project, 'ds1')).toBe(true);
    expect(node.fields[1]!.missing).toBe(false);
    expect(node.dataMissing).toBe(false);
    expect(revalidateCollectionFields(project, 'ds1')).toBe(false);
  });

  it('treats an unavailable dataset as missing data', () => {
    const project = createEmptyProject('测试');
    project.datasets.push(makeDataset({ dataUnavailable: true }));
    const node = makeCollection();
    project.nodes[node.id] = node;
    revalidateCollectionFields(project, 'ds1');
    expect(node.dataMissing).toBe(true);
    expect(collectionBindingIssue(node, project.datasets[0])).toBe('数据集不可用');
  });

  it('reports stale column bindings', () => {
    const project = createEmptyProject('测试');
    const node = makeCollection();
    project.nodes[node.id] = node;
    expect(collectionBindingIssue(node, makeDataset())).toBeNull();
    expect(collectionBindingIssue(node, makeDataset({ columns: [] }))).toContain('已不存在');
    expect(collectionBindingIssue(node, undefined)).toBe('绑定的数据集不存在');
  });
});

describe('collection name conflicts', () => {
  it('rejects field names that shadow globals, builtins or sibling fields', () => {
    const project = createEmptyProject('测试');
    const node = makeCollection();
    project.nodes[node.id] = node;
    const attack = createVariableNode('攻击力', { x: 0, y: 0 }, { value: 1 });
    project.nodes[attack.id] = attack;

    expect(findFieldNameConflict(project, node.id, '攻击力')).toContain('冲突');
    expect(findFieldNameConflict(project, node.id, 'sqrt')).toContain('内置');
    expect(findFieldNameConflict(project, node.id, 'HP')).toContain('已存在');
    expect(findFieldNameConflict(project, node.id, 'HP', 'f-hp')).toBeNull();
    expect(findFieldNameConflict(project, node.id, 'NewField')).toBeNull();
    expect(findFieldNameConflict(project, node.id, '  ')).toBe('字段名不能为空');
  });

  it('rejects variables that shadow collection fields', () => {
    const project = createEmptyProject('测试');
    const node = makeCollection();
    project.nodes[node.id] = node;
    expect(findFieldConflictForVariable(project, 'hp')).toContain('字段冲突');
    expect(findFieldConflictForVariable(project, '其他')).toBeNull();
  });
});

describe('collection field DAG', () => {
  it('lists unresolved globals separately from field dependencies', () => {
    const project = createEmptyProject('测试');
    const node = makeCollection();
    node.fields[2]!.formula = 'HP * 倍率 + curve(ATK)';
    project.nodes[node.id] = node;
    const analysis = analyzeCollectionFields(node);
    // `curve(ATK)` contributes both the callee name and its argument.
    expect(new Set(analysis.dependencies.get('f-power'))).toEqual(new Set(['f-hp', 'f-atk']));
    expect(analysis.unresolved.get('f-power')).toEqual(['倍率', 'curve']);
    expect(analysis.fieldErrors.size).toBe(0);
  });

  it('marks cycles and dependents', () => {
    const project = createEmptyProject('测试');
    const node = makeCollection();
    node.fields = [
      { id: 'a', name: 'A', label: 'A', type: 'number', role: 'derived', formula: 'B + 1' },
      { id: 'b', name: 'B', label: 'B', type: 'number', role: 'derived', formula: 'A + 1' },
      { id: 'c', name: 'C', label: 'C', type: 'number', role: 'derived', formula: 'A * 2' },
    ];
    project.nodes[node.id] = node;
    const analysis = analyzeCollectionFields(node);
    expect(analysis.fieldErrors.get('a')).toBe('派生列存在循环引用');
    expect(analysis.fieldErrors.get('b')).toBe('派生列存在循环引用');
    expect(analysis.fieldErrors.get('c')).toBe('依赖的派生列存在循环引用');
  });
});
