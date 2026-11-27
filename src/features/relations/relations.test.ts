import { describe, expect, it } from 'vitest';
import {
  addNode,
  createEmptyProject,
  createGroupNode,
  createVariableNode,
} from '@/core/model/factories';
import {
  collectRelationRows,
  dependencyTargetFromEdgeId,
  dependencyTargetsFromEdgeIds,
  formulaFromConstant,
  isScalarVariable,
} from './relations';

function projectWithNodes() {
  const project = createEmptyProject('测试');
  const group = createGroupNode('分组1', { x: 0, y: 0 });
  const base = createVariableNode('基础攻击', { x: 0, y: 0 }, {
    variableKind: 'constant',
    role: 'input',
    value: 100,
  });
  const bonus = createVariableNode('加成', { x: 0, y: 0 }, {
    variableKind: 'constant',
    role: 'input',
    value: 20,
  });
  const damage = createVariableNode('伤害', { x: 0, y: 0 }, {
    variableKind: 'formula',
    role: 'intermediate',
    formula: '基础攻击 + 加成',
  });
  addNode(project, group);
  addNode(project, base);
  addNode(project, bonus);
  addNode(project, damage);
  return { project, group, base, bonus, damage };
}

describe('collectRelationRows', () => {
  it('lists only scalar quantities and attaches their sources', () => {
    const { project, base, bonus, damage } = projectWithNodes();
    const dependencies = new Map([[damage.id, [base.id, bonus.id]]]);

    const rows = collectRelationRows(project, dependencies);

    expect(rows.map((row) => row.node.label)).toEqual(['基础攻击', '加成', '伤害']);
    const damageRow = rows.find((row) => row.node.id === damage.id)!;
    expect(damageRow.sources.map((source) => source.name)).toEqual(['基础攻击', '加成']);
    expect(rows.find((row) => row.node.id === base.id)!.sources).toEqual([]);
  });

  it('skips curves, tables and groups', () => {
    const { project, group } = projectWithNodes();
    const curve = createVariableNode('曲线', { x: 0, y: 0 }, { variableKind: 'curve' });
    addNode(project, curve);

    const rows = collectRelationRows(project, new Map());

    expect(rows.some((row) => row.node.id === curve.id)).toBe(false);
    expect(rows.some((row) => row.node.id === group.id)).toBe(false);
  });

  it('sorts labels with numeric suffixes naturally', () => {
    const project = createEmptyProject('测试');
    for (const name of ['变量10', '变量2', '变量1']) {
      addNode(
        project,
        createVariableNode(name, { x: 0, y: 0 }, { variableKind: 'constant', value: 0 }),
      );
    }
    const rows = collectRelationRows(project, new Map());
    expect(rows.map((row) => row.node.label)).toEqual(['变量1', '变量2', '变量10']);
  });
});

describe('dependency edge ids', () => {
  it('extracts the target from a dependency edge id', () => {
    expect(dependencyTargetFromEdgeId('d:abc->xyz')).toBe('xyz');
    expect(dependencyTargetFromEdgeId('d:a-b_c->x-y_z')).toBe('x-y_z');
  });

  it('ignores other relation kinds and malformed ids', () => {
    expect(dependencyTargetFromEdgeId('h:abc->xyz')).toBeNull();
    expect(dependencyTargetFromEdgeId('i:rel1')).toBeNull();
    expect(dependencyTargetFromEdgeId('d:abc')).toBeNull();
    expect(dependencyTargetFromEdgeId('')).toBeNull();
  });

  it('deduplicates targets from aggregated proxy edges', () => {
    expect(
      dependencyTargetsFromEdgeIds(['d:a->t', 'd:b->t', 'h:a->t', 'd:c->u']),
    ).toEqual(['t', 'u']);
  });
});

describe('isScalarVariable', () => {
  it('accepts constants and formulas only', () => {
    const { project, group, base, damage } = projectWithNodes();
    const curve = createVariableNode('曲线', { x: 0, y: 0 }, { variableKind: 'curve' });
    expect(isScalarVariable(project.nodes[base.id])).toBe(true);
    expect(isScalarVariable(project.nodes[damage.id])).toBe(true);
    expect(isScalarVariable(curve)).toBe(false);
    expect(isScalarVariable(group)).toBe(false);
    expect(isScalarVariable(undefined)).toBe(false);
  });
});

describe('formulaFromConstant', () => {
  it('starts the formula from the current value', () => {
    const { base } = projectWithNodes();
    expect(formulaFromConstant(base)).toBe('100');
    expect(formulaFromConstant({ ...base, value: undefined })).toBe('0');
  });
});
