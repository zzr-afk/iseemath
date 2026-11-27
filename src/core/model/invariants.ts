import type { AnyNode, NodeId, Project } from './types';

export const IDENTIFIER_PATTERN = /^[\p{L}_][\p{L}\p{N}_]*$/u;

export function isValidIdentifier(name: string): boolean {
  return IDENTIFIER_PATTERN.test(name);
}

export function nodeChildren(project: Project, parentId: NodeId): AnyNode[] {
  return Object.values(project.nodes).filter((node) => node.parentId === parentId);
}

/** Walk up from candidateParent; if we hit nodeId, the link would create a cycle. */
export function wouldCreateHierarchyCycle(
  project: Project,
  nodeId: NodeId,
  candidateParentId: NodeId | null,
): boolean {
  if (candidateParentId === null) return false;
  if (candidateParentId === nodeId) return true;
  const seen = new Set<NodeId>();
  let cursor: NodeId | null = candidateParentId;
  while (cursor) {
    if (cursor === nodeId) return true;
    if (seen.has(cursor)) return true;
    seen.add(cursor);
    cursor = project.nodes[cursor]?.parentId ?? null;
  }
  return false;
}

export function hierarchyDepth(project: Project, nodeId: NodeId): number {
  const seen = new Set<NodeId>();
  let depth = 0;
  let cursor = project.nodes[nodeId]?.parentId ?? null;
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    depth += 1;
    cursor = project.nodes[cursor]?.parentId ?? null;
  }
  return depth;
}

export function descendantIds(project: Project, nodeId: NodeId): Set<NodeId> {
  const result = new Set<NodeId>();
  const stack = [nodeId];
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const node of Object.values(project.nodes)) {
      if (node.parentId === current && !result.has(node.id)) {
        result.add(node.id);
        stack.push(node.id);
      }
    }
  }
  return result;
}

function checkNames(nodes: AnyNode[], label: string, errors: string[]): void {
  const seen = new Map<string, string>();
  for (const node of nodes) {
    if (!isValidIdentifier(node.name)) {
      errors.push(`${label}「${node.label}」的名称不是合法标识符：${node.name}`);
      continue;
    }
    const key = node.name.toLocaleLowerCase();
    const other = seen.get(key);
    if (other !== undefined && other !== node.id) {
      errors.push(`${label}名称重复（不区分大小写）：${node.name}`);
    } else {
      seen.set(key, node.id);
    }
  }
}

export function validateProject(project: Project): string[] {
  const errors: string[] = [];
  const nodes = Object.values(project.nodes);

  checkNames(nodes.filter((node) => node.kind === 'variable'), '变量', errors);
  checkNames(nodes.filter((node) => node.kind === 'group'), '分组', errors);
  checkNames(nodes.filter((node) => node.kind === 'collection'), '数据表', errors);

  for (const node of nodes) {
    if (node.parentId !== null) {
      if (!project.nodes[node.parentId]) {
        errors.push(`节点「${node.label}」的上级不存在：${node.parentId}`);
      } else if (wouldCreateHierarchyCycle(project, node.id, node.parentId)) {
        errors.push(`归属层级存在环：${node.label}`);
      }
    }
    if (node.kind === 'variable') {
      if (!['constant', 'formula', 'curve', 'table'].includes(node.variableKind)) {
        errors.push(`变量「${node.label}」的类型无效`);
      }
      if (node.variableKind === 'constant' && node.role === 'input' && node.formula) {
        errors.push(`输入变量「${node.label}」不应带公式`);
      }
    }
    if (node.kind === 'collection') {
      const fieldNames = new Set<string>();
      for (const field of node.fields) {
        const key = field.name.toLocaleLowerCase();
        if (fieldNames.has(key)) {
          errors.push(`数据表「${node.label}」字段名重复：${field.name}`);
        }
        fieldNames.add(key);
      }
    }
  }

  const relationIds = new Set<string>();
  for (const relation of project.relations) {
    if (!project.nodes[relation.source]) {
      errors.push(`影响边起点不存在：${relation.source}`);
    }
    if (!project.nodes[relation.target]) {
      errors.push(`影响边终点不存在：${relation.target}`);
    }
    if (relationIds.has(relation.id)) {
      errors.push(`影响边 id 重复：${relation.id}`);
    }
    relationIds.add(relation.id);
  }

  const bundleNames = new Set<string>();
  const bundledNodeIds = new Set<NodeId>();
  for (const bundle of project.bundles) {
    const bundleKey = bundle.name.toLocaleLowerCase();
    if (bundleNames.has(bundleKey)) {
      errors.push(`折叠包名称重复：${bundle.name}`);
    }
    bundleNames.add(bundleKey);
    if (bundle.memberIds.length === 0) {
      errors.push(`折叠包「${bundle.name}」至少需要一个成员`);
    }
    for (const memberId of bundle.memberIds) {
      const member = project.nodes[memberId];
      if (!member) {
        errors.push(`折叠包「${bundle.name}」的成员不存在：${memberId}`);
        continue;
      }
      if (bundledNodeIds.has(memberId)) {
        errors.push(`变量「${member.label}」同时属于多个折叠包`);
      }
      bundledNodeIds.add(memberId);
      if (member.kind !== 'variable' || !['constant', 'formula'].includes(member.variableKind)) {
        errors.push(`折叠包「${bundle.name}」包含不可打包的节点：${member.label}`);
      }
    }
    if (bundle.summary.mode === 'member') {
      if (!bundle.summary.memberId || !bundle.memberIds.includes(bundle.summary.memberId)) {
        errors.push(`折叠包「${bundle.name}」的汇总成员无效`);
      }
    }
  }

  return errors;
}
