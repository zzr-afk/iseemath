import { nanoid } from 'nanoid';
import type {
  AnyNode,
  CollectionNode,
  FieldDef,
  GroupNode,
  NodeBase,
  NodeId,
  Project,
  VariableNode,
  VariableRole,
  Vec2,
} from './types';

export const SCHEMA_VERSION = 1 as const;

export function now(): number {
  return Date.now();
}

export function createEmptyProject(name = '未命名项目'): Project {
  const timestamp = now();
  return {
    schemaVersion: SCHEMA_VERSION,
    id: nanoid(),
    name,
    nodes: {},
    datasets: [],
    views: [],
    comparisons: [],
    tombstones: [],
    relations: [],
    bundles: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function baseNode(_kind: AnyNode['kind'], name: string, position: Vec2): Omit<NodeBase, 'kind'> {
  const timestamp = now();
  return {
    id: nanoid(),
    name,
    label: name,
    tags: [],
    parentId: null,
    position,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function createVariableNode(
  name: string,
  position: Vec2,
  options: {
    variableKind?: VariableNode['variableKind'];
    role?: VariableRole;
    value?: number;
    formula?: string;
    label?: string;
  } = {},
): VariableNode {
  const { variableKind = 'constant', role = 'input', value, formula, label } = options;
  return {
    ...baseNode('variable', name, position),
    kind: 'variable',
    variableKind,
    role,
    value: variableKind === 'constant' ? (value ?? 0) : undefined,
    formula: variableKind === 'formula' ? (formula ?? '') : undefined,
    label: label ?? name,
  } as VariableNode;
}

export function createGroupNode(name: string, position: Vec2, label?: string): GroupNode {
  return {
    ...baseNode('group', name, position),
    kind: 'group',
    label: label ?? name,
  } as GroupNode;
}

export function createCollectionNode(
  name: string,
  position: Vec2,
  datasetId: string,
  fields: FieldDef[] = [],
  label?: string,
): CollectionNode {
  return {
    ...baseNode('collection', name, position),
    kind: 'collection',
    datasetId,
    fields,
    dataRevision: 0,
    label: label ?? name,
  } as CollectionNode;
}

export function addNode(project: Project, node: AnyNode): Project {
  project.nodes[node.id] = node;
  project.updatedAt = now();
  return project;
}

export function removeNode(project: Project, nodeId: NodeId): void {
  delete project.nodes[nodeId];
  for (const node of Object.values(project.nodes)) {
    if (node.parentId === nodeId) node.parentId = null;
  }
  project.relations = project.relations.filter(
    (relation) => relation.source !== nodeId && relation.target !== nodeId,
  );
  for (const bundle of project.bundles) {
    bundle.memberIds = bundle.memberIds.filter((id) => id !== nodeId);
    if (bundle.summary.memberId === nodeId) {
      bundle.summary.mode = 'none';
      delete bundle.summary.memberId;
    }
  }
  project.bundles = project.bundles.filter((bundle) => bundle.memberIds.length > 0);
  if (project.scenarios) {
    for (const scenario of project.scenarios) delete scenario.overrides[nodeId];
  }
  project.updatedAt = now();
}
