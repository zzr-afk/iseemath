import { describe, expect, it } from 'vitest';
import { buildColumnarTable } from '@/core/logs/parse';
import { createEmptyProject, createVariableNode } from '@/core/model/factories';
import type { CollectionNode, FieldDef, Project } from '@/core/model/types';
import { evaluateCollectionColumns } from './batch';

function makeTable(rows: string[][], header: string[]) {
  return buildColumnarTable([header, ...rows], { hasHeader: true });
}

function makeCollection(
  project: Project,
  table: ReturnType<typeof makeTable>,
  fields: FieldDef[],
): CollectionNode {
  const node: CollectionNode = {
    id: 'coll',
    kind: 'collection',
    name: '怪物',
    label: '怪物',
    description: undefined,
    tags: [],
    parentId: null,
    position: { x: 0, y: 0 },
    createdAt: 0,
    updatedAt: 0,
    datasetId: 'ds1',
    fields,
    dataRevision: 0,
  };
  project.nodes[node.id] = node;
  void table;
  return node;
}

function inputField(id: string, name: string, column: number, table: ReturnType<typeof makeTable>): FieldDef {
  return {
    id,
    name,
    label: name,
    type: 'number',
    role: 'input',
    sourceColumnId: table.columns[column]!.id,
  };
}

function derivedField(id: string, name: string, formula: string): FieldDef {
  return { id, name, label: name, type: 'number', role: 'derived', formula };
}

describe('collection batch evaluation', () => {
  it('computes derived columns from input fields', () => {
    const project = createEmptyProject('批量');
    const table = makeTable(
      [
        ['100', '10', '50'],
        ['200', '20', '100'],
      ],
      ['hp', 'atk', 'def'],
    );
    const fields = [
      inputField('f-hp', 'HP', 0, table),
      inputField('f-atk', 'ATK', 1, table),
      inputField('f-def', 'DEF', 2, table),
      derivedField('f-power', 'Power', 'HP * ATK / (DEF + 100)'),
    ];
    const node = makeCollection(project, table, fields);
    const result = evaluateCollectionColumns(project, node, table);

    expect(result.fieldErrors).toEqual({});
    const power = result.fields['f-power']!;
    expect(power.valid[0]).toBe(1);
    expect(power.values[0]).toBeCloseTo((100 * 10) / 150, 10);
    expect(power.valid[1]).toBe(1);
    expect(power.values[1]).toBeCloseTo((200 * 20) / 200, 10);
    expect(result.errorRows).toBe(0);
  });

  it('resolves derived fields in dependency order', () => {
    const project = createEmptyProject('批量');
    const table = makeTable([['10']], ['hp']);
    const fields = [
      inputField('f-hp', 'HP', 0, table),
      derivedField('f-a', 'A', 'HP * 2'),
      derivedField('f-b', 'B', 'A + 1'),
    ];
    const node = makeCollection(project, table, fields);
    const result = evaluateCollectionColumns(project, node, table);
    expect(result.order).toEqual(['f-a', 'f-b']);
    expect(result.fields['f-b']!.values[0]).toBe(21);
  });

  it('supports global constants, curves and tables in row scope', () => {
    const project = createEmptyProject('批量');
    const table = makeTable([['10'], ['20']], ['level']);
    const multiplier = createVariableNode('倍率', { x: 0, y: 0 }, { value: 3 });
    project.nodes[multiplier.id] = multiplier;
    const fields = [
      { ...inputField('f-level', 'Level', 0, table) },
      derivedField('f-out', 'Out', 'Level * 倍率'),
    ];
    const node = makeCollection(project, table, fields);
    const result = evaluateCollectionColumns(project, node, table);
    expect(result.fields['f-out']!.values[0]).toBe(30);
    expect(result.fields['f-out']!.values[1]).toBe(60);
  });

  it('marks cyclic derived columns and blocks dependents', () => {
    const project = createEmptyProject('批量');
    const table = makeTable([['1']], ['x']);
    const fields = [
      derivedField('f-a', 'A', 'B + 1'),
      derivedField('f-b', 'B', 'A + 1'),
      derivedField('f-c', 'C', 'A * 2'),
    ];
    const node = makeCollection(project, table, fields);
    const result = evaluateCollectionColumns(project, node, table);
    expect(result.fieldErrors['f-a']).toBe('派生列存在循环引用');
    expect(result.fieldErrors['f-b']).toBe('派生列存在循环引用');
    expect(result.fieldErrors['f-c']).toBe('依赖的派生列存在循环引用');
    expect(result.fields['f-a']!.valid[0]).toBe(0);
  });

  it('reports empty input rows without poisoning other rows', () => {
    const project = createEmptyProject('批量');
    const table = makeTable([[''], ['20']], ['hp']);
    const fields = [inputField('f-hp', 'HP', 0, table), derivedField('f-d', 'D', 'HP * 2')];
    const node = makeCollection(project, table, fields);
    const result = evaluateCollectionColumns(project, node, table);
    const derived = result.fields['f-d']!;
    expect(derived.valid[0]).toBe(0);
    expect(derived.valid[1]).toBe(1);
    expect(derived.values[1]).toBe(40);
    expect(derived.errorRows).toBe(1);
    expect(derived.firstError?.message).toContain('在该行为空');
    expect(result.errorRows).toBe(1);
  });

  it('reports unknown globals and rejects text fields statically', () => {
    const project = createEmptyProject('批量');
    const table = makeTable([['a', '1']], ['server', 'hp']);
    const fields = [
      { ...inputField('f-server', 'Server', 0, table), type: 'string' as const },
      inputField('f-hp', 'HP', 1, table),
      derivedField('f-a', 'A', 'Server + 1'),
      derivedField('f-b', 'B', 'HP + 未知'),
    ];
    const node = makeCollection(project, table, fields);
    const result = evaluateCollectionColumns(project, node, table);
    expect(result.fieldErrors['f-a']).toContain('非数值字段');
    expect(result.fields['f-b']!.errorRows).toBe(1);
    expect(result.fields['f-b']!.firstError?.message).toContain('未知变量');
  });
});
