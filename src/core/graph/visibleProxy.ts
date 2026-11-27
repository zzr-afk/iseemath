import type { NodeId, Project, ProjectViewState, Vec2 } from '@/core/model/types';

export const BUNDLE_PROXY_PREFIX = 'b:';

export function bundleProxyId(bundleId: string): string {
  return `${BUNDLE_PROXY_PREFIX}${bundleId}`;
}

export function isBundleProxyId(id: string): boolean {
  return id.startsWith(BUNDLE_PROXY_PREFIX);
}

export function bundleIdFromProxy(proxyId: string): string {
  return proxyId.slice(BUNDLE_PROXY_PREFIX.length);
}

export interface BundleAnchor {
  bundleId: string;
  position: Vec2;
  width: number;
  height: number;
  visibleMemberCount: number;
  hiddenMemberCount: number;
}

export interface VisibleGraph {
  /** nodeId -> proxy id. Visible nodes map to themselves. */
  proxyOf: Map<NodeId, NodeId>;
  hiddenNodeIds: Set<NodeId>;
  /** Bundles whose collapsed cards should be rendered. */
  bundleAnchors: Map<string, BundleAnchor>;
  /** Node ids hidden specifically because they sit inside a collapsed group. */
  groupHiddenNodeIds: Set<NodeId>;
}

const DEFAULT_NODE_WIDTH = 208;
const DEFAULT_NODE_HEIGHT = 76;

function isHiddenByGroup(project: Project, groupCollapsed: Record<NodeId, boolean>, nodeId: NodeId): boolean {
  const seen = new Set<NodeId>();
  let cursor = project.nodes[nodeId]?.parentId ?? null;
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    if (groupCollapsed[cursor]) return true;
    cursor = project.nodes[cursor]?.parentId ?? null;
  }
  return false;
}

/** Nearest ancestor that is a collapsed group and itself visible. */
function nearestVisibleCollapsedGroup(
  project: Project,
  groupCollapsed: Record<NodeId, boolean>,
  nodeId: NodeId,
): NodeId | null {
  const seen = new Set<NodeId>();
  let cursor = project.nodes[nodeId]?.parentId ?? null;
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    if (groupCollapsed[cursor] && !isHiddenByGroup(project, groupCollapsed, cursor)) {
      return cursor;
    }
    cursor = project.nodes[cursor]?.parentId ?? null;
  }
  return null;
}

function bundleIdForNode(project: Project, nodeId: NodeId, collapsedOnly: boolean, viewState: ProjectViewState): string | null {
  for (const bundle of project.bundles) {
    if (collapsedOnly && !viewState.bundleCollapsed[bundle.id]) continue;
    if (bundle.memberIds.includes(nodeId)) return bundle.id;
  }
  return null;
}

/**
 * Fixed-point projection from the full graph to what is on screen.
 * Group collapse takes precedence over bundle collapse for edge mapping.
 */
export function projectVisibleGraph(
  project: Project,
  viewState: ProjectViewState,
  nodeSizes: Record<NodeId, { width: number; height: number }> = {},
): VisibleGraph {
  const groupCollapsed = viewState.groupCollapsed ?? {};
  const proxyOf = new Map<NodeId, NodeId>();
  const hiddenNodeIds = new Set<NodeId>();
  const groupHiddenNodeIds = new Set<NodeId>();
  const bundleAnchors = new Map<string, BundleAnchor>();

  const groupHidden = new Map<NodeId, boolean>();
  for (const nodeId of Object.keys(project.nodes)) {
    groupHidden.set(nodeId, isHiddenByGroup(project, groupCollapsed, nodeId));
  }

  // Decide which bundle cards are visible: collapsed and at least one member
  // not hidden by a collapsed group.
  const visibleBundleIds = new Set<string>();
  for (const bundle of project.bundles) {
    if (!viewState.bundleCollapsed[bundle.id]) continue;
    const hasVisibleMember = bundle.memberIds.some(
      (memberId) => project.nodes[memberId] && !groupHidden.get(memberId),
    );
    if (hasVisibleMember) visibleBundleIds.add(bundle.id);
  }

  for (const node of Object.values(project.nodes)) {
    if (groupHidden.get(node.id)) {
      hiddenNodeIds.add(node.id);
      groupHiddenNodeIds.add(node.id);
      proxyOf.set(node.id, nearestVisibleCollapsedGroup(project, groupCollapsed, node.id) ?? node.id);
      continue;
    }
    const bundleId = bundleIdForNode(project, node.id, true, viewState);
    if (bundleId && visibleBundleIds.has(bundleId)) {
      hiddenNodeIds.add(node.id);
      proxyOf.set(node.id, bundleProxyId(bundleId));
      continue;
    }
    proxyOf.set(node.id, node.id);
  }

  for (const bundleId of visibleBundleIds) {
    const bundle = project.bundles.find((item) => item.id === bundleId);
    if (!bundle) continue;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let visibleMemberCount = 0;
    let hiddenMemberCount = 0;
    for (const memberId of bundle.memberIds) {
      const member = project.nodes[memberId];
      if (!member) continue;
      if (groupHidden.get(memberId)) {
        hiddenMemberCount += 1;
        continue;
      }
      visibleMemberCount += 1;
      const size = nodeSizes[memberId] ?? {
        width: DEFAULT_NODE_WIDTH,
        height: DEFAULT_NODE_HEIGHT,
      };
      minX = Math.min(minX, member.position.x);
      minY = Math.min(minY, member.position.y);
      maxX = Math.max(maxX, member.position.x + size.width);
      maxY = Math.max(maxY, member.position.y + size.height);
    }
    if (!Number.isFinite(minX) || !Number.isFinite(minY)) continue;
    bundleAnchors.set(bundleId, {
      bundleId,
      position: { x: minX, y: minY },
      width: Math.max(200, Math.min(360, maxX - minX)),
      height: Math.max(72, Math.min(160, maxY - minY)),
      visibleMemberCount,
      hiddenMemberCount,
    });
  }

  return { proxyOf, hiddenNodeIds, bundleAnchors, groupHiddenNodeIds };
}

export function proxyIdOf(graph: VisibleGraph, nodeId: NodeId): NodeId {
  return graph.proxyOf.get(nodeId) ?? nodeId;
}
