import { describe, expect, it } from 'vitest';
import { bundleProxyId, projectVisibleGraph } from './visibleProxy';
import { summarizeBundle } from './bundles';
import { createEmptyProject, createGroupNode, createVariableNode } from '@/core/model/factories';
import { createBundle } from '@/core/model/commands';
import type { Project, ProjectViewState } from '@/core/model/types';

function emptyView(overrides: Partial<ProjectViewState> = {}): ProjectViewState {
  return {
    schemaVersion: 1,
    bundleCollapsed: {},
    groupCollapsed: {},
    nodeSizes: {},
    ...overrides,
  };
}

function makeMultiplierScene(): {
  project: Project;
  group: string;
  members: string[];
  output: string;
} {
  const project = createEmptyProject('乘区');
  const group = createGroupNode('伤害组', { x: 0, y: 0 });
  project.nodes[group.id] = group;
  const members = [
    createVariableNode('攻防乘区', { x: 0, y: 100 }, { value: 1.5 }),
    createVariableNode('技能乘区', { x: 220, y: 100 }, { value: 2 }),
    createVariableNode('元素乘区', { x: 440, y: 100 }, { value: 1.25 }),
  ];
  for (const member of members) {
    member.parentId = group.id;
    project.nodes[member.id] = member;
  }
  const output = createVariableNode('总伤害', { x: 0, y: 260 }, {
    variableKind: 'formula',
    role: 'output',
    formula: '攻防乘区 * 技能乘区 * 元素乘区',
  });
  project.nodes[output.id] = output;
  return { project, group: group.id, members: members.map((node) => node.id), output: output.id };
}

describe('projectVisibleGraph', () => {
  it('folds bundle members into one card', () => {
    const { project, members } = makeMultiplierScene();
    const bundle = createBundle(project, '乘区包', members);
    const view = emptyView({ bundleCollapsed: { [bundle.id]: true } });
    const graph = projectVisibleGraph(project, view);

    for (const memberId of members) {
      expect(graph.hiddenNodeIds.has(memberId)).toBe(true);
      expect(graph.proxyOf.get(memberId)).toBe(bundleProxyId(bundle.id));
    }
    const anchor = graph.bundleAnchors.get(bundle.id);
    expect(anchor).toBeDefined();
    expect(anchor!.visibleMemberCount).toBe(3);
    expect(anchor!.position).toEqual({ x: 0, y: 100 });
  });

  it('keeps members visible when the bundle is expanded', () => {
    const { project, members } = makeMultiplierScene();
    const bundle = createBundle(project, '乘区包', members);
    const graph = projectVisibleGraph(project, emptyView());
    for (const memberId of members) {
      expect(graph.hiddenNodeIds.has(memberId)).toBe(false);
      expect(graph.proxyOf.get(memberId)).toBe(memberId);
    }
    expect(graph.bundleAnchors.size).toBe(0);
    expect(graph.proxyOf.get(members[0]!)).not.toBe(bundleProxyId(bundle.id));
  });

  it('lets group collapse win over bundle collapse', () => {
    const { project, group, members } = makeMultiplierScene();
    const bundle = createBundle(project, '乘区包', members);
    const view = emptyView({
      bundleCollapsed: { [bundle.id]: true },
      groupCollapsed: { [group]: true },
    });
    const graph = projectVisibleGraph(project, view);

    // All members are group-hidden, so the bundle card is not visible and the
    // group is the edge proxy.
    expect(graph.bundleAnchors.has(bundle.id)).toBe(false);
    for (const memberId of members) {
      expect(graph.proxyOf.get(memberId)).toBe(group);
    }
  });

  it('still shows the card when only part of the bundle is group-hidden', () => {
    const { project, members } = makeMultiplierScene();
    const subgroup = createGroupNode('子组', { x: 1000, y: 0 });
    project.nodes[subgroup.id] = subgroup;
    project.nodes[members[0]!]!.parentId = subgroup.id;
    const bundle = createBundle(project, '乘区包', members);
    const view = emptyView({
      bundleCollapsed: { [bundle.id]: true },
      groupCollapsed: { [subgroup.id]: true },
    });
    const graph = projectVisibleGraph(project, view);

    const anchor = graph.bundleAnchors.get(bundle.id);
    expect(anchor).toBeDefined();
    expect(anchor!.hiddenMemberCount).toBe(1);
    expect(anchor!.visibleMemberCount).toBe(2);
    expect(graph.proxyOf.get(members[0]!)).toBe(subgroup.id);
    expect(graph.proxyOf.get(members[1]!)).toBe(bundleProxyId(bundle.id));
  });

  it('uses cached sizes for the card bounding box', () => {
    const { project, members } = makeMultiplierScene();
    for (const memberId of members) project.nodes[memberId]!.position = { x: 0, y: 0 };
    const bundle = createBundle(project, '乘区包', members);
    const view = emptyView({ bundleCollapsed: { [bundle.id]: true } });
    const graph = projectVisibleGraph(project, view, {
      [members[2]!]: { width: 300, height: 120 },
    });
    const anchor = graph.bundleAnchors.get(bundle.id)!;
    expect(anchor.width).toBe(300);
    expect(anchor.height).toBe(120);
  });
});

describe('summarizeBundle', () => {
  it('computes product summaries', () => {
    const { project, members } = makeMultiplierScene();
    const bundle = createBundle(project, '乘区包', members);
    bundle.summary = { mode: 'product' };
    const values = {
      [members[0]!]: 1.5,
      [members[1]!]: 2,
      [members[2]!]: 1.25,
    };
    const summary = summarizeBundle(bundle, values, {});
    expect(summary.value).toBeCloseTo(3.75, 10);
  });

  it('shows an error instead of a partial aggregate', () => {
    const { project, members } = makeMultiplierScene();
    const bundle = createBundle(project, '乘区包', members);
    bundle.summary = { mode: 'sum' };
    const summary = summarizeBundle(
      bundle,
      { [members[0]!]: 1, [members[1]!]: 2 },
      { [members[2]!]: '循环引用' },
    );
    expect(summary.errorCount).toBe(1);
    expect(summary.text).toBe('—');
  });

  it('only reacts to the selected member in member mode', () => {
    const { project, members } = makeMultiplierScene();
    const bundle = createBundle(project, '乘区包', members);
    bundle.summary = { mode: 'member', memberId: members[1]! };
    const summary = summarizeBundle(
      bundle,
      { [members[0]!]: 1, [members[1]!]: 2 },
      { [members[0]!]: '循环引用' },
    );
    expect(summary.value).toBe(2);
    expect(summary.text).toBe('2');
  });
});
