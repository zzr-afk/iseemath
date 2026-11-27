import { describe, expect, it } from 'vitest';
import { buildDependencyGraph } from './dependency';
import { findCycles } from './cycle';
import { evaluateProject } from '@/core/eval/projectEval';
import { createEmptyProject, createVariableNode } from '@/core/model/factories';
import { setNodeParent } from '@/core/model/commands';
import type { Project } from '@/core/model/types';

function makeChain(): {
  project: Project;
  attack: string;
  multiplier: string;
  damage: string;
} {
  const project = createEmptyProject('战斗');
  const attack = createVariableNode('攻击力', { x: 0, y: 0 }, { value: 100 });
  const multiplier = createVariableNode('倍率', { x: 0, y: 100 }, { value: 2 });
  const damage = createVariableNode('伤害', { x: 0, y: 200 }, {
    variableKind: 'formula',
    role: 'output',
    formula: '攻击力 * 倍率',
  });
  for (const node of [attack, multiplier, damage]) project.nodes[node.id] = node;
  return { project, attack: attack.id, multiplier: multiplier.id, damage: damage.id };
}

describe('dependency graph', () => {
  it('derives edges from formula identifiers', () => {
    const { project, attack, multiplier, damage } = makeChain();
    const graph = buildDependencyGraph(project);
    expect(new Set(graph.dependencies.get(damage))).toEqual(new Set([attack, multiplier]));
    expect(graph.unresolved.get(damage)).toBeUndefined();
  });

  it('reports unresolved identifiers', () => {
    const { project, damage } = makeChain();
    const node = project.nodes[damage]!;
    if (node.kind !== 'variable') throw new Error('bad fixture');
    node.formula = '攻击力 * 未知系数';
    const graph = buildDependencyGraph(project);
    expect(graph.unresolved.get(damage)).toEqual(['未知系数']);
  });

  it('excludes local bindings from dependencies and evaluation errors', () => {
    const { project, attack, multiplier, damage } = makeChain();
    const node = project.nodes[damage]!;
    if (node.kind !== 'variable') throw new Error('bad fixture');
    node.formula = 'let a = 攻击力 * 倍率; let b = a + 10; b';
    const graph = buildDependencyGraph(project);
    expect(new Set(graph.dependencies.get(damage))).toEqual(new Set([attack, multiplier]));
    expect(graph.unresolved.get(damage)).toBeUndefined();
    const result = evaluateProject(project);
    expect(result.values[damage]).toBe(210);
  });

  it('detects cycles and marks all members', () => {
    const { project, attack, damage } = makeChain();
    const node = project.nodes[attack]!;
    if (node.kind !== 'variable') throw new Error('bad fixture');
    node.variableKind = 'formula';
    node.formula = '伤害 + 1';
    const graph = buildDependencyGraph(project);
    const { cycles, inCycle } = findCycles(graph.dependencies);
    expect(cycles.length).toBe(1);
    expect(inCycle.has(attack)).toBe(true);
    expect(inCycle.has(damage)).toBe(true);

    const result = evaluateProject(project);
    expect(result.errors[attack]).toBe('循环引用');
    expect(result.errors[damage]).toBe('循环引用');
  });

  it('evaluates in dependency order', () => {
    const { project, damage } = makeChain();
    const result = evaluateProject(project);
    expect(result.values[damage]).toBe(200);
    expect(result.cycles).toEqual([]);
  });

  it('derives dependency edges for curve calls', () => {
    const project = createEmptyProject('曲线');
    const curve = createVariableNode('攻击曲线', { x: 0, y: 0 }, { variableKind: 'curve' });
    curve.curve = {
      points: [
        { x: 1, y: 10 },
        { x: 10, y: 100 },
      ],
      interpolation: 'linear',
      extrapolation: 'clamp',
    };
    const level = createVariableNode('等级', { x: 0, y: 100 }, { value: 5 });
    const attack = createVariableNode('攻击力', { x: 0, y: 200 }, {
      variableKind: 'formula',
      role: 'output',
      formula: '攻击曲线(等级)',
    });
    for (const node of [curve, level, attack]) project.nodes[node.id] = node;
    const graph = buildDependencyGraph(project);
    expect(graph.dependencies.get(attack.id)).toContain(curve.id);
    const result = evaluateProject(project);
    expect(result.values[attack.id]).toBeCloseTo(50, 10);
  });

  it('keeps hierarchy separate from evaluation', () => {
    const { project, attack, damage } = makeChain();
    const group = createVariableNode('角色', { x: 0, y: 0 }, {});
    project.nodes[group.id] = group;
    setNodeParent(project, attack, group.id);
    const result = evaluateProject(project);
    expect(result.values[damage]).toBe(200);
    const graph = buildDependencyGraph(project);
    expect(graph.dependencies.get(damage)).not.toContain(group.id);
  });
});
