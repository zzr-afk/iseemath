import { nanoid } from 'nanoid';
import {
  addNode,
  now,
  removeNode,
} from './factories';
import { renameFreeIdentifiers } from '@/core/formula/rename';
import { wouldCreateHierarchyCycle } from './invariants';
import {
  findFieldConflictForVariable,
  findFieldNameConflict,
  revalidateCollectionFields,
} from './collection';
import type {
  AnalysisView,
  AnyNode,
  Bundle,
  CollectionNode,
  DatasetMeta,
  FieldDef,
  NodeId,
  Project,
  Relation,
  VariableNode,
  Vec2,
} from './types';

export class CommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CommandError';
  }
}

export function addVariableNode(project: Project, node: VariableNode): void {
  addNode(project, node);
}

export function addGroupNode(project: Project, node: AnyNode): void {
  addNode(project, node);
}

export function addCollectionNode(project: Project, node: CollectionNode): void {
  if (!project.datasets.some((dataset) => dataset.id === node.datasetId)) {
    throw new CommandError('绑定的数据集不存在');
  }
  addNode(project, node);
  revalidateCollectionFields(project, node.datasetId);
}

function requireCollection(project: Project, collectionId: NodeId): CollectionNode {
  const node = project.nodes[collectionId];
  if (!node || node.kind !== 'collection') throw new CommandError('数据表不存在');
  return node;
}

export function addCollectionField(
  project: Project,
  collectionId: NodeId,
  field: FieldDef,
): void {
  const node = requireCollection(project, collectionId);
  const conflict = findFieldNameConflict(project, collectionId, field.name);
  if (conflict) throw new CommandError(conflict);
  if (field.role === 'derived' && field.type !== 'number') {
    throw new CommandError('派生列只能输出数值');
  }
  node.fields.push(field);
  node.updatedAt = now();
  node.dataRevision += 1;
  revalidateCollectionFields(project, node.datasetId);
  project.updatedAt = now();
}

export function updateCollectionField(
  project: Project,
  collectionId: NodeId,
  fieldId: string,
  patch: Partial<FieldDef>,
): void {
  const node = requireCollection(project, collectionId);
  const field = node.fields.find((candidate) => candidate.id === fieldId);
  if (!field) throw new CommandError('字段不存在');
  if (patch.name !== undefined && patch.name !== field.name) {
    const conflict = findFieldNameConflict(project, collectionId, patch.name, fieldId);
    if (conflict) throw new CommandError(conflict);
  }
  const nextRole = patch.role ?? field.role;
  if (nextRole === 'derived' && (patch.type ?? field.type) !== 'number') {
    throw new CommandError('派生列只能输出数值');
  }
  Object.assign(field, patch, { missing: undefined });
  node.updatedAt = now();
  node.dataRevision += 1;
  revalidateCollectionFields(project, node.datasetId);
  project.updatedAt = now();
}

export function removeCollectionField(
  project: Project,
  collectionId: NodeId,
  fieldId: string,
): void {
  const node = requireCollection(project, collectionId);
  node.fields = node.fields.filter((field) => field.id !== fieldId);
  node.updatedAt = now();
  node.dataRevision += 1;
  project.updatedAt = now();
}

export function setCollectionDataset(
  project: Project,
  collectionId: NodeId,
  datasetId: string,
): void {
  const node = requireCollection(project, collectionId);
  if (!project.datasets.some((dataset) => dataset.id === datasetId)) {
    throw new CommandError('数据集不存在');
  }
  node.datasetId = datasetId;
  node.dataRevision += 1;
  node.updatedAt = now();
  revalidateCollectionFields(project, datasetId);
  project.updatedAt = now();
}

/**
 * Rewrite every formula that refers to the variable by its old symbol. Local
 * `let` bindings that shadow the name are left alone, and data-table field
 * names count as bound because they take precedence inside row formulas.
 * Formulas that currently fail to parse are preserved verbatim.
 */
function renameVariableReferences(
  project: Project,
  node: VariableNode,
  newName: string,
): void {
  const oldName = node.name;
  if (oldName === newName) return;

  for (const candidate of Object.values(project.nodes)) {
    if (candidate.kind === 'variable') {
      if (candidate.variableKind !== 'formula' || !candidate.formula) continue;
      const next = renameFreeIdentifiers(candidate.formula, oldName, newName);
      if (next !== null && next !== candidate.formula) {
        candidate.formula = next;
        candidate.updatedAt = now();
      }
      continue;
    }
    if (candidate.kind !== 'collection') continue;
    const boundNames = candidate.fields.map((field) => field.name);
    let changed = false;
    for (const field of candidate.fields) {
      if (field.role !== 'derived' || !field.formula) continue;
      const next = renameFreeIdentifiers(field.formula, oldName, newName, {
        boundNames,
      });
      if (next !== null && next !== field.formula) {
        field.formula = next;
        changed = true;
      }
    }
    if (changed) candidate.updatedAt = now();
  }
}

export function updateNode(
  project: Project,
  nodeId: NodeId,
  patch: Partial<AnyNode>,
): void {
  const node = project.nodes[nodeId];
  if (!node) throw new CommandError('节点不存在');
  if (patch.name !== undefined && node.kind === 'variable') {
    const conflict = findFieldConflictForVariable(project, patch.name);
    if (conflict) throw new CommandError(conflict);
    if (patch.name !== node.name) renameVariableReferences(project, node, patch.name);
  }
  Object.assign(node, patch, { updatedAt: now() });
  project.updatedAt = now();
}

export function setNodeParent(
  project: Project,
  nodeId: NodeId,
  parentId: NodeId | null,
): void {
  const node = project.nodes[nodeId];
  if (!node) throw new CommandError('节点不存在');
  if (parentId !== null) {
    if (!project.nodes[parentId]) throw new CommandError('上级节点不存在');
    if (wouldCreateHierarchyCycle(project, nodeId, parentId)) {
      throw new CommandError('归属层级不能成环');
    }
  }
  node.parentId = parentId;
  node.updatedAt = now();
  project.updatedAt = now();
}

export function moveNodes(project: Project, moves: Record<NodeId, Vec2>): void {
  for (const [nodeId, position] of Object.entries(moves)) {
    const node = project.nodes[nodeId];
    if (!node) continue;
    node.position = { x: position.x, y: position.y };
    node.updatedAt = now();
  }
  project.updatedAt = now();
}

export function deleteNode(project: Project, nodeId: NodeId): void {
  const node = project.nodes[nodeId];
  if (!node) return;
  // Only direct children are promoted; deeper descendants keep their chain.
  const directChildren = Object.values(project.nodes)
    .filter((candidate) => candidate.parentId === nodeId)
    .map((candidate) => candidate.id);
  project.tombstones.push({ nodeId, name: node.name, deletedAt: now() });
  if (project.tombstones.length > 500) {
    project.tombstones.sort((a, b) => a.deletedAt - b.deletedAt);
    project.tombstones = project.tombstones.slice(project.tombstones.length - 500);
  }
  removeNode(project, nodeId);
  for (const childId of directChildren) {
    const child = project.nodes[childId];
    if (child) child.parentId = node.parentId;
  }
  project.updatedAt = now();
}

export function addInfluence(project: Project, source: NodeId, target: NodeId): Relation {
  if (!project.nodes[source] || !project.nodes[target]) {
    throw new CommandError('影响边端点不存在');
  }
  if (source === target) throw new CommandError('不能连接自身');
  if (
    project.relations.some(
      (relation) =>
        relation.kind === 'influence' &&
        relation.source === source &&
        relation.target === target,
    )
  ) {
    throw new CommandError('影响关系已存在');
  }
  const relation: Relation = {
    id: nanoid(),
    source,
    target,
    kind: 'influence',
  };
  project.relations.push(relation);
  project.updatedAt = now();
  return relation;
}

export function deleteInfluence(project: Project, relationId: string): void {
  project.relations = project.relations.filter((relation) => relation.id !== relationId);
  project.updatedAt = now();
}

export function createBundle(
  project: Project,
  name: string,
  memberIds: NodeId[],
): Bundle {
  if (project.bundles.some((bundle) => bundle.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
    throw new CommandError('折叠包名称已存在');
  }
  if (memberIds.length === 0) throw new CommandError('折叠包至少需要一个成员');
  const bundled = new Set(project.bundles.flatMap((bundle) => bundle.memberIds));
  for (const memberId of memberIds) {
    const node = project.nodes[memberId];
    if (!node) throw new CommandError('折叠包成员不存在');
    if (bundled.has(memberId)) throw new CommandError(`「${node.label}」已属于其他折叠包`);
    if (node.kind !== 'variable' || !['constant', 'formula'].includes(node.variableKind)) {
      throw new CommandError(`「${node.label}」不可打包`);
    }
  }
  const bundle: Bundle = {
    id: nanoid(),
    name,
    memberIds: [...memberIds],
    summary: { mode: 'none' },
  };
  project.bundles.push(bundle);
  project.updatedAt = now();
  return bundle;
}

export function updateBundle(
  project: Project,
  bundleId: string,
  patch: Partial<Pick<Bundle, 'name' | 'color' | 'memberIds'>>,
): void {
  const bundle = project.bundles.find((item) => item.id === bundleId);
  if (!bundle) throw new CommandError('折叠包不存在');
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) throw new CommandError('折叠包名称不能为空');
    const duplicate = project.bundles.some(
      (item) => item.id !== bundleId && item.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
    );
    if (duplicate) throw new CommandError('折叠包名称已存在');
    bundle.name = name;
  }
  if (patch.color !== undefined) bundle.color = patch.color;
  if (patch.memberIds !== undefined) {
    const bundled = new Set(
      project.bundles
        .filter((item) => item.id !== bundleId)
        .flatMap((item) => item.memberIds),
    );
    const unique = [...new Set(patch.memberIds)];
    if (unique.length === 0) throw new CommandError('折叠包至少需要一个成员');
    for (const memberId of unique) {
      const node = project.nodes[memberId];
      if (!node) throw new CommandError('折叠包成员不存在');
      if (bundled.has(memberId)) throw new CommandError(`「${node.label}」已属于其他折叠包`);
      if (node.kind !== 'variable' || !['constant', 'formula'].includes(node.variableKind)) {
        throw new CommandError(`「${node.label}」不可打包`);
      }
    }
    bundle.memberIds = unique;
    if (bundle.summary.mode === 'member' && !unique.includes(bundle.summary.memberId ?? '')) {
      bundle.summary = { mode: 'none' };
    }
  }
  project.updatedAt = now();
}

export function updateBundleSummary(
  project: Project,
  bundleId: string,
  summary: Bundle['summary'],
): void {
  const bundle = project.bundles.find((item) => item.id === bundleId);
  if (!bundle) throw new CommandError('折叠包不存在');
  if (summary.mode === 'member') {
    if (!summary.memberId || !bundle.memberIds.includes(summary.memberId)) {
      throw new CommandError('汇总成员不在包内');
    }
  }
  bundle.summary = summary;
  project.updatedAt = now();
}

export function dissolveBundle(project: Project, bundleId: string): void {
  project.bundles = project.bundles.filter((bundle) => bundle.id !== bundleId);
  project.updatedAt = now();
}

export function addDataset(project: Project, meta: DatasetMeta): void {
  if (project.datasets.some((dataset) => dataset.id === meta.id)) {
    throw new CommandError('数据集已存在');
  }
  project.datasets.push(meta);
  project.updatedAt = now();
}

/** Replace metadata fields after a successful rebuild (system command). */
export function replaceDatasetMeta(project: Project, meta: DatasetMeta): void {
  const index = project.datasets.findIndex((dataset) => dataset.id === meta.id);
  if (index === -1) throw new CommandError('数据集不存在');
  project.datasets[index] = meta;
  project.updatedAt = now();
}

/**
 * Remove a dataset and break every view referencing it. Data blobs/manual rows
 * are not deleted here: the command cannot touch IndexedDB, so callers register
 * them for delayed collection after the document write succeeds.
 */
export function removeDataset(project: Project, datasetId: string): void {
  const index = project.datasets.findIndex((dataset) => dataset.id === datasetId);
  if (index === -1) throw new CommandError('数据集不存在');
  project.datasets.splice(index, 1);
  for (const view of project.views) {
    if (view.datasetId !== datasetId || view.status !== 'active') continue;
    view.status = 'broken';
    view.brokenReason = '数据集已删除';
    view.updatedAt = now();
  }
  // Keep bound collections structurally consistent (schema kept, data marked
  // missing) so they can be repaired after a replacement import.
  revalidateCollectionFields(project, datasetId);
  project.updatedAt = now();
}

/** Mark a dataset unusable (missing/corrupt source) without removing metadata. */
export function markDatasetUnavailable(project: Project, datasetId: string, reason: string): void {
  const dataset = project.datasets.find((candidate) => candidate.id === datasetId);
  if (!dataset || dataset.dataUnavailable) return;
  dataset.dataUnavailable = true;
  for (const view of project.views) {
    if (view.datasetId !== datasetId || view.status !== 'active') continue;
    view.status = 'broken';
    view.brokenReason = reason;
    view.updatedAt = now();
  }
  revalidateCollectionFields(project, datasetId);
  project.updatedAt = now();
}

export function addAnalysisView(project: Project, view: AnalysisView): void {
  if (project.views.some((candidate) => candidate.id === view.id)) {
    throw new CommandError('分析视图已存在');
  }
  project.views.push(view);
  project.updatedAt = now();
}

export function removeAnalysisView(project: Project, viewId: string): void {
  project.views = project.views.filter((view) => view.id !== viewId);
  project.updatedAt = now();
}
