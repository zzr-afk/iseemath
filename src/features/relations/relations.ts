import type { AnyNode, NodeId, Project, VariableNode } from '@/core/model/types';

/** A scalar quantity: either a free input (constant) or a derived formula. */
export function isScalarVariable(node: AnyNode | undefined): node is VariableNode {
  return Boolean(
    node &&
      node.kind === 'variable' &&
      (node.variableKind === 'constant' || node.variableKind === 'formula'),
  );
}

export interface RelationSource {
  id: NodeId;
  name: string;
  label: string;
}

export interface RelationRow {
  node: VariableNode;
  /** Variables referenced by this row's formula, in formula resolution order. */
  sources: RelationSource[];
}

/**
 * Build the rows of the outer relations panel from the project and the
 * dependency graph. Only scalar quantities are listed: curves and tables are
 * defined through their own editors and are invoked as functions.
 */
export function collectRelationRows(
  project: Project,
  dependencies: Map<NodeId, NodeId[]>,
): RelationRow[] {
  const rows: RelationRow[] = [];
  for (const node of Object.values(project.nodes)) {
    if (!isScalarVariable(node)) continue;
    const sources: RelationSource[] = [];
    for (const sourceId of dependencies.get(node.id) ?? []) {
      const source = project.nodes[sourceId];
      if (!source || source.kind !== 'variable') continue;
      sources.push({ id: source.id, name: source.name, label: source.label });
    }
    rows.push({ node, sources });
  }
  rows.sort((left, right) =>
    left.node.label.localeCompare(right.node.label, 'zh-Hans-CN', { numeric: true }),
  );
  return rows;
}

/**
 * Dependency edge ids have the form `d:source->target`. Node ids are nanoids
 * and never contain `->`, so the last occurrence is the separator even when a
 * proxy edge holds several origin ids.
 */
export function dependencyTargetFromEdgeId(edgeId: string): NodeId | null {
  if (!edgeId.startsWith('d:')) return null;
  const arrow = edgeId.lastIndexOf('->');
  if (arrow < 0) return null;
  const target = edgeId.slice(arrow + 2);
  return target || null;
}

export function dependencyTargetsFromEdgeIds(edgeIds: readonly string[]): NodeId[] {
  const targets: NodeId[] = [];
  for (const edgeId of edgeIds) {
    const target = dependencyTargetFromEdgeId(edgeId);
    if (target && !targets.includes(target)) targets.push(target);
  }
  return targets;
}

/** Initial formula when turning a free input into a derived quantity. */
export function formulaFromConstant(node: VariableNode): string {
  return String(node.value ?? 0);
}
