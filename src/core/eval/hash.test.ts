import { describe, expect, it } from 'vitest';
import { computeEvalHash } from './hash';
import { createEmptyProject, createVariableNode } from '@/core/model/factories';
import type { Project } from '@/core/model/types';

function projectWithValue(value: number): Project {
  const project = createEmptyProject('测试');
  const node = createVariableNode('攻击力', { x: 0, y: 0 }, { value });
  project.nodes[node.id] = node;
  return project;
}

describe('computeEvalHash', () => {
  it('ignores layout, label, color and hierarchy changes', () => {
    const project = projectWithValue(10);
    const before = computeEvalHash(project);
    const node = Object.values(project.nodes)[0]!;
    node.position = { x: 400, y: 200 };
    node.label = '改名';
    node.color = '#fff';
    node.parentId = node.id;
    expect(computeEvalHash(project)).toBe(before);
  });

  it('changes when a constant value changes', () => {
    const before = computeEvalHash(projectWithValue(10));
    const after = computeEvalHash(projectWithValue(11));
    expect(after).not.toBe(before);
  });

  it('changes when a formula changes', () => {
    const project = projectWithValue(10);
    const node = Object.values(project.nodes)[0]!;
    if (node.kind !== 'variable') throw new Error('bad fixture');
    node.variableKind = 'formula';
    node.formula = '1 + 1';
    const before = computeEvalHash(project);
    node.formula = '1 + 2';
    expect(computeEvalHash(project)).not.toBe(before);
  });
});
