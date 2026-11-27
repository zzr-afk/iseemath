import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeTypes,
  type OnSelectionChangeParams,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { nanoid } from 'nanoid';
import { Button, Dropdown, Input, Modal, Segmented, Select, Tooltip, message } from 'antd';
import {
  ApartmentOutlined,
  DownOutlined,
  FolderOutlined,
  InboxOutlined,
  PlusOutlined,
  TableOutlined,
} from '@ant-design/icons';
import VariableNodeView from './nodes/VariableNodeView';
import GroupNodeView from './nodes/GroupNodeView';
import BundleNodeView from './nodes/BundleNodeView';
import { useProjectStore } from '@/stores/projectStore';
import { useRuntimeStore } from '@/stores/runtimeStore';
import { useUiStore, type EdgeFilter } from '@/stores/uiStore';
import { useViewStore } from '@/stores/viewStore';
import { createCollectionNode, createGroupNode, createVariableNode } from '@/core/model/factories';
import {
  addCollectionNode,
  addInfluence,
  createBundle,
  deleteInfluence,
  moveNodes,
  setNodeParent,
  updateNode,
} from '@/core/model/commands';
import {
  analyzeCollectionFields,
  findFieldConflictForVariable,
  findGlobalNameConflict,
} from '@/core/model/collection';
import { collectionSummary, collectionGlobalDependencies } from '@/core/eval/batch';
import { evaluateProject } from '@/core/eval/projectEval';
import { computeEvalHash } from '@/core/eval/hash';
import { buildDependencyGraph } from '@/core/graph/dependency';
import { findCycles } from '@/core/graph/cycle';
import {
  bundleIdFromProxy,
  bundleProxyId,
  isBundleProxyId,
  projectVisibleGraph,
  proxyIdOf,
} from '@/core/graph/visibleProxy';
import { summarizeBundle } from '@/core/graph/bundles';
import { formatNumber } from '@/utils/format';
import { appendDependencyFormula } from './dependencyLink';
import { nextNodePosition, uniqueNodeName } from './placement';
import { dependencyTargetsFromEdgeIds } from '@/features/relations/relations';
import type {
  AnyNode,
  BundleSummaryMode,
  NodeId,
  Vec2,
} from '@/core/model/types';
import styles from './CanvasWorkspace.module.css';

const nodeTypes: NodeTypes = {
  variable: VariableNodeView,
  group: GroupNodeView,
  bundle: BundleNodeView,
};

const EDGE_COLORS = {
  hierarchy: '#7f93a8',
  dependency: '#58c4ff',
  influence: '#f0b84b',
} as const;

interface RawEdge {
  id: string;
  source: NodeId;
  target: NodeId;
  kind: keyof typeof EDGE_COLORS;
  sourceHandle: string;
  targetHandle: string;
}

interface AggregatedEdge {
  id: string;
  source: string;
  target: string;
  kind: keyof typeof EDGE_COLORS;
  sourceHandle: string;
  targetHandle: string;
  originEdgeIds: string[];
  proxy: boolean;
  count: number;
}

export default function CanvasWorkspace() {
  const project = useProjectStore((state) => state.project);
  const runCommand = useProjectStore((state) => state.runCommand);
  const readOnly = useProjectStore((state) => state.readOnly);
  const values = useRuntimeStore((state) => state.values);
  const errors = useRuntimeStore((state) => state.errors);
  const publishEvaluation = useRuntimeStore((state) => state.publishEvaluation);
  const selectedNodeIds = useUiStore((state) => state.selectedNodeIds);
  const selectedBundleId = useUiStore((state) => state.selectedBundleId);
  const selectNodes = useUiStore((state) => state.selectNodes);
  const selectBundle = useUiStore((state) => state.selectBundle);
  const setEditingCollectionId = useUiStore((state) => state.setEditingCollectionId);
  const edgeFilter = useUiStore((state) => state.edgeFilter);
  const setEdgeFilter = useUiStore((state) => state.setEdgeFilter);
  const focusRelation = useUiStore((state) => state.focusRelation);
  const viewState = useViewStore((state) => state.viewState);
  const setNodeSizes = useViewStore((state) => state.setNodeSizes);
  const setBundleCollapsed = useViewStore((state) => state.setBundleCollapsed);

  const [packOpen, setPackOpen] = useState(false);
  const [packName, setPackName] = useState('');
  const [packMode, setPackMode] = useState<BundleSummaryMode>('none');
  const [packMemberId, setPackMemberId] = useState<string | undefined>(undefined);

  const evaluation = useMemo(() => evaluateProject(project), [project]);
  const evalHash = useMemo(() => computeEvalHash(project), [project]);

  useEffect(() => {
    publishEvaluation(evalHash, evaluation.values, evaluation.errors);
  }, [evalHash, evaluation, publishEvaluation]);

  const childCounts = useMemo(() => {
    const counts = new Map<NodeId, number>();
    for (const node of Object.values(project.nodes)) {
      if (node.parentId) counts.set(node.parentId, (counts.get(node.parentId) ?? 0) + 1);
    }
    return counts;
  }, [project.nodes]);

  const collectionStats = useMemo(() => {
    const map = new Map<
      NodeId,
      { rows: number; fields: number; derivedErrors: number; missing: boolean }
    >();
    for (const node of Object.values(project.nodes)) {
      if (node.kind !== 'collection') continue;
      const dataset = project.datasets.find((candidate) => candidate.id === node.datasetId);
      map.set(node.id, {
        rows: dataset?.rowCount ?? 0,
        fields: node.fields.length,
        derivedErrors: analyzeCollectionFields(node).fieldErrors.size,
        missing: Boolean(node.dataMissing),
      });
    }
    return map;
  }, [project.nodes, project.datasets]);

  const collectionDeps = useMemo(() => {
    const edges: { source: NodeId; target: NodeId }[] = [];
    for (const node of Object.values(project.nodes)) {
      if (node.kind !== 'collection') continue;
      for (const global of collectionGlobalDependencies(project, node)) {
        edges.push({ source: global.id, target: node.id });
      }
    }
    return edges;
  }, [project.nodes]);

  const nodeSizes = useMemo(() => viewState.nodeSizes ?? {}, [viewState.nodeSizes]);

  const visibleGraph = useMemo(
    () => projectVisibleGraph(project, viewState, nodeSizes),
    [project, viewState, nodeSizes],
  );

  const bundleSummaries = useMemo(() => {
    const map = new Map<string, ReturnType<typeof summarizeBundle>>();
    for (const bundle of project.bundles) {
      map.set(bundle.id, summarizeBundle(bundle, values, errors));
    }
    return map;
  }, [project.bundles, values, errors]);

  const baseNodes = useMemo<Node[]>(() => {
    const nodes: Node[] = [];
    for (const node of Object.values(project.nodes)) {
      const selected = selectedNodeIds.includes(node.id);
      if (node.kind === 'group') {
        nodes.push({
          id: node.id,
          type: 'group',
          position: node.position,
          hidden: visibleGraph.hiddenNodeIds.has(node.id),
          selected,
          data: {
            nodeId: node.id,
            label: node.label,
            name: node.name,
            childCount: childCounts.get(node.id) ?? 0,
            collapsed: Boolean(viewState.groupCollapsed[node.id]),
            selected,
          },
        });
      } else if (node.kind === 'collection') {
        const stats = collectionStats.get(node.id);
        nodes.push({
          id: node.id,
          type: 'variable',
          position: node.position,
          hidden: visibleGraph.hiddenNodeIds.has(node.id),
          selected,
          data: {
            label: node.label,
            name: node.name,
            badge: '数据表',
            valueText: stats
              ? collectionSummary(node, stats.rows)
              : `${node.fields.length} 字段`,
            error: stats?.missing
              ? '数据缺失：请检查数据集绑定'
              : stats && stats.derivedErrors > 0
                ? `${stats.derivedErrors} 个派生列有问题`
                : undefined,
            selected,
          },
        });
      } else {
        nodes.push({
          id: node.id,
          type: 'variable',
          position: node.position,
          hidden: visibleGraph.hiddenNodeIds.has(node.id),
          selected,
          data: {
            label: node.label,
            name: node.name,
            unit: node.unit,
            valueText: formatNumber(values[node.id]),
            error: errors[node.id],
            selected,
            source: node.variableKind === 'constant',
          },
        });
      }
    }

    for (const [bundleId, anchor] of visibleGraph.bundleAnchors) {
      const bundle = project.bundles.find((item) => item.id === bundleId);
      if (!bundle) continue;
      const summary = bundleSummaries.get(bundleId);
      nodes.push({
        id: bundleProxyId(bundleId),
        type: 'bundle',
        position: anchor.position,
        selected: selectedBundleId === bundleId,
        data: {
          bundleId,
          name: bundle.name,
          memberCount: bundle.memberIds.length,
          hiddenMemberCount: anchor.hiddenMemberCount,
          summaryText: summary?.text ?? '—',
          summaryMode: bundle.summary.mode,
          errorCount: summary?.errorCount ?? 0,
          color: bundle.color,
          selected: selectedBundleId === bundleId,
        },
      });
    }
    return nodes;
  }, [
    project.nodes,
    project.bundles,
    values,
    errors,
    selectedNodeIds,
    selectedBundleId,
    visibleGraph,
    bundleSummaries,
    childCounts,
    collectionStats,
    viewState.groupCollapsed,
  ]);

  const [flowNodes, setFlowNodes] = useState<Node[]>(baseNodes);
  const draggingRef = useRef(false);

  useEffect(() => {
    if (draggingRef.current) return;
    setFlowNodes((previous) => {
      const previousById = new Map(previous.map((node) => [node.id, node]));
      return baseNodes.map((node) => {
        const old = previousById.get(node.id);
        if (!old) return node;
        if (old.measured || old.width || old.height) {
          return { ...node, measured: old.measured, width: old.width, height: old.height };
        }
        return node;
      });
    });
  }, [baseNodes]);

  // Cache measured node sizes so collapsed bundle cards can be positioned
  // without mounting their hidden members.
  useEffect(() => {
    const sizes: Record<NodeId, { width: number; height: number }> = {};
    let changed = false;
    for (const node of flowNodes) {
      if (isBundleProxyId(node.id)) continue;
      const width = node.measured?.width ?? node.width;
      const height = node.measured?.height ?? node.height;
      if (typeof width !== 'number' || typeof height !== 'number') continue;
      const previous = nodeSizes[node.id];
      if (
        !previous ||
        Math.abs(previous.width - width) > 0.5 ||
        Math.abs(previous.height - height) > 0.5
      ) {
        sizes[node.id] = { width, height };
        changed = true;
      }
    }
    if (changed) setNodeSizes(sizes);
  }, [flowNodes, nodeSizes, setNodeSizes]);

  const baseEdges = useMemo<Edge[]>(() => {
    const raw: RawEdge[] = [];

    if (edgeFilter === 'all' || edgeFilter === 'hierarchy') {
      for (const node of Object.values(project.nodes)) {
        if (!node.parentId) continue;
        raw.push({
          id: `h:${node.parentId}->${node.id}`,
          source: node.parentId,
          target: node.id,
          kind: 'hierarchy',
          sourceHandle: 'h-out',
          targetHandle: 'h-in',
        });
      }
    }

    if (edgeFilter === 'all' || edgeFilter === 'dependency') {
      for (const edge of evaluation.dependencyEdges) {
        raw.push({
          id: `d:${edge.source}->${edge.target}`,
          source: edge.source,
          target: edge.target,
          kind: 'dependency',
          sourceHandle: 'dep-out',
          targetHandle: 'dep-in',
        });
      }
      // Type-level edges: a collection depends on a global when any derived
      // field references it. Instances are never drawn as separate nodes.
      for (const edge of collectionDeps) {
        raw.push({
          id: `d:${edge.source}->${edge.target}`,
          source: edge.source,
          target: edge.target,
          kind: 'dependency',
          sourceHandle: 'dep-out',
          targetHandle: 'dep-in',
        });
      }
    }

    if (edgeFilter === 'all' || edgeFilter === 'influence') {
      for (const relation of project.relations) {
        raw.push({
          id: `i:${relation.id}`,
          source: relation.source,
          target: relation.target,
          kind: 'influence',
          sourceHandle: 'influence-out',
          targetHandle: 'influence-in',
        });
      }
    }

    const aggregated = new Map<string, AggregatedEdge>();
    for (const edge of raw) {
      const source = proxyIdOf(visibleGraph, edge.source);
      const target = proxyIdOf(visibleGraph, edge.target);
      if (source === target) continue;
      const proxy = source !== edge.source || target !== edge.target;
      const key = `${edge.kind}|${source}|${target}`;
      const existing = aggregated.get(key);
      if (existing) {
        existing.originEdgeIds.push(edge.id);
        existing.count += 1;
        existing.proxy = existing.proxy || proxy;
        continue;
      }
      aggregated.set(key, {
        id: proxy ? `p:${edge.kind}:${source}->${target}` : edge.id,
        source,
        target,
        kind: edge.kind,
        sourceHandle: edge.sourceHandle,
        targetHandle: edge.targetHandle,
        originEdgeIds: [edge.id],
        proxy,
        count: 1,
      });
    }

    const edges: Edge[] = [];
    for (const edge of aggregated.values()) {
      const color = EDGE_COLORS[edge.kind];
      const arrow = { type: MarkerType.ArrowClosed, width: 14, height: 14, color };
      edges.push({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.sourceHandle,
        targetHandle: edge.targetHandle,
        type: 'default',
        label: edge.count > 1 ? `×${edge.count}` : undefined,
        labelStyle: { fill: '#9fb2c6', fontSize: 10 },
        labelBgStyle: { fill: '#111a24', fillOpacity: 0.9 },
        style: {
          stroke: color,
          strokeWidth: edge.kind === 'hierarchy' ? 1.4 : 1.6,
          strokeDasharray:
            edge.kind === 'hierarchy' ? '5 4' : edge.kind === 'influence' ? '2 5' : edge.proxy ? '6 4' : undefined,
          opacity: edge.proxy ? 0.65 : 1,
        },
        markerEnd: arrow,
        data: { proxy: edge.proxy, originEdgeIds: edge.originEdgeIds },
      });
    }
    return edges;
  }, [
    project.nodes,
    project.relations,
    evaluation.dependencyEdges,
    collectionDeps,
    edgeFilter,
    visibleGraph,
  ]);

  const [flowEdges, setFlowEdges] = useState<Edge[]>(baseEdges);

  useEffect(() => {
    setFlowEdges(baseEdges);
  }, [baseEdges]);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setFlowEdges((edges) => applyEdgeChanges(changes, edges));
  }, []);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setFlowNodes((nodes) => applyNodeChanges(changes, nodes));
  }, []);

  const selectedEdgesRef = useRef<Edge[]>([]);

  const onSelectionChange = useCallback(
    ({ nodes, edges }: OnSelectionChangeParams) => {
      selectedEdgesRef.current = edges;
      const bundleNode = nodes.find((node) => isBundleProxyId(node.id));
      if (bundleNode) {
        selectBundle(bundleIdFromProxy(bundleNode.id));
        return;
      }
      selectNodes(nodes.map((node) => node.id));
    },
    [selectNodes, selectBundle],
  );

  const onEdgeClick = useCallback(
    (_event: unknown, edge: Edge) => {
      const data = edge.data as { originEdgeIds?: string[] } | undefined;
      const originIds = data?.originEdgeIds?.length ? data.originEdgeIds : [edge.id];
      const targets = dependencyTargetsFromEdgeIds(originIds);
      if (targets.length > 0) focusRelation(targets[0]!);
    },
    [focusRelation],
  );

  const connectDependency = useCallback(
    (sourceId: NodeId, targetId: NodeId) => {
      const sourceNode = project.nodes[sourceId];
      const targetNode = project.nodes[targetId];
      if (!sourceNode || sourceNode.kind !== 'variable') {
        message.warning('请从变量右侧的依赖端口拉线');
        return;
      }
      if (!targetNode || targetNode.kind !== 'variable') {
        message.warning('推导关系只能连接到变量');
        return;
      }
      if (sourceId === targetId) {
        message.warning('变量不能依赖自己');
        return;
      }
      if (sourceNode.variableKind === 'curve' || sourceNode.variableKind === 'table') {
        message.warning('曲线/表格变量需要在公式中用「名称(参数)」调用，暂不支持直接连线');
        return;
      }
      if (targetNode.variableKind === 'curve' || targetNode.variableKind === 'table') {
        message.warning('曲线/表格变量不能作为公式结果');
        return;
      }

      const existingGraph = buildDependencyGraph(project);
      if (existingGraph.dependencies.get(targetId)?.includes(sourceId)) {
        message.info('这两个变量之间已经有推导关系');
        return;
      }

      const nextFormula = appendDependencyFormula(
        targetNode.variableKind === 'formula' ? targetNode.formula : undefined,
        sourceNode.name,
      );
      try {
        runCommand('建立推导关系', (draft) => {
          updateNode(draft, targetId, {
            variableKind: 'formula',
            formula: nextFormula,
            ...(targetNode.variableKind === 'constant' && targetNode.role === 'input'
              ? { role: 'intermediate' as const }
              : {}),
          } as Partial<AnyNode>);
          const graph = buildDependencyGraph(draft);
          const { inCycle } = findCycles(graph.dependencies);
          if (inCycle.has(targetId)) {
            throw new Error('这条连线会形成循环引用');
          }
        });
        message.success(
          `已建立 ${sourceNode.label} → ${targetNode.label}，可在「关系结构」里修改公式`,
        );
        focusRelation(targetId);
      } catch (error) {
        message.error(error instanceof Error ? error.message : String(error));
      }
    },
    [project, runCommand, focusRelation],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      const { source, target, sourceHandle, targetHandle } = connection;
      if (!source || !target) return;
      if (isBundleProxyId(source) || isBundleProxyId(target)) {
        message.info('请先展开折叠包，再在成员之间建立关系');
        return;
      }
      try {
        if (sourceHandle === 'influence-out' && targetHandle === 'influence-in') {
          runCommand('新建影响关系', (draft) => {
            addInfluence(draft, source, target);
          });
          return;
        }
        if (sourceHandle === 'h-out' && targetHandle === 'h-in') {
          runCommand('修改归属', (draft) => setNodeParent(draft, target, source));
          return;
        }
        if (sourceHandle === 'dep-out' && targetHandle === 'dep-in') {
          connectDependency(source, target);
          return;
        }
      } catch (error) {
        message.error(error instanceof Error ? error.message : String(error));
        return;
      }
      message.info('从变量右侧蓝色端口拖到另一个变量左侧蓝色端口，即可建立推导关系');
    },
    [connectDependency, runCommand],
  );

  const deleteSelectedEdges = useCallback(() => {
    const selected = selectedEdgesRef.current;
    if (selected.length === 0) return;
    const influenceIds = new Set<string>();
    const hierarchyChildren = new Set<NodeId>();
    let sawDependency = false;

    for (const edge of selected) {
      const data = edge.data as { originEdgeIds?: string[] } | undefined;
      const originIds = data?.originEdgeIds?.length ? data.originEdgeIds : [edge.id];
      for (const originId of originIds) {
        if (originId.startsWith('i:')) {
          influenceIds.add(originId.slice(2));
        } else if (originId.startsWith('h:')) {
          const child = originId.split('->')[1];
          if (child) hierarchyChildren.add(child);
        } else if (originId.startsWith('d:')) {
          sawDependency = true;
        }
      }
    }

    if (sawDependency) {
      message.info('计算依赖由公式自动生成，请修改公式来删除依赖边');
    }
    if (influenceIds.size > 0) {
      runCommand('删除影响关系', (draft) => {
        for (const relationId of influenceIds) deleteInfluence(draft, relationId);
      });
    }
    if (hierarchyChildren.size > 0) {
      runCommand('解除归属', (draft) => {
        for (const child of hierarchyChildren) setNodeParent(draft, child, null);
      });
    }
    selectedEdgesRef.current = [];
  }, [runCommand]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key !== 'Delete' && event.key !== 'Backspace') return;
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return;
      }
      if (selectedEdgesRef.current.length === 0) return;
      event.preventDefault();
      deleteSelectedEdges();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [deleteSelectedEdges]);

  const onNodeDragStart = useCallback(() => {
    draggingRef.current = true;
  }, []);

  const onNodeDragStop = useCallback(
    (_event: unknown, _node: Node, nodes: Node[]) => {
      draggingRef.current = false;
      const moves: Record<NodeId, Vec2> = {};
      for (const item of nodes) {
        if (isBundleProxyId(item.id)) {
          const bundleId = bundleIdFromProxy(item.id);
          const anchor = visibleGraph.bundleAnchors.get(bundleId);
          const bundle = project.bundles.find((entry) => entry.id === bundleId);
          if (!anchor || !bundle) continue;
          const dx = item.position.x - anchor.position.x;
          const dy = item.position.y - anchor.position.y;
          for (const memberId of bundle.memberIds) {
            if (visibleGraph.proxyOf.get(memberId) !== item.id) continue;
            const member = project.nodes[memberId];
            if (!member) continue;
            moves[memberId] = {
              x: member.position.x + dx,
              y: member.position.y + dy,
            };
          }
        } else {
          moves[item.id] = { x: item.position.x, y: item.position.y };
        }
      }
      if (Object.keys(moves).length > 0) {
        runCommand('移动节点', (draft) => moveNodes(draft, moves));
      }
    },
    [runCommand, visibleGraph, project],
  );

  function addCollection() {
    if (readOnly) {
      message.warning('当前标签页为只读');
      return;
    }
    const dataset =
      project.datasets.find((candidate) => !candidate.dataUnavailable) ?? project.datasets[0];
    if (!dataset) {
      message.warning('请先在「日志分析」中导入数据集，再创建数据表');
      return;
    }
    const used = new Set<string>();
    const fields = dataset.columns.map((column) => {
      const base = column.name.trim() || '字段';
      let candidate = base;
      let suffix = 2;
      while (used.has(candidate.toLocaleLowerCase()) || findGlobalNameConflict(project, candidate)) {
        candidate = `${base}${suffix}`;
        suffix += 1;
      }
      used.add(candidate.toLocaleLowerCase());
      return {
        id: nanoid(),
        name: candidate,
        label: candidate,
        type: column.type,
        role: 'input' as const,
        sourceColumnId: column.id,
      };
    });
    const node = createCollectionNode(
      uniqueNodeName(project, '数据表'),
      nextNodePosition(project),
      dataset.id,
      fields,
    );
    try {
      runCommand('新建数据表', (draft) => addCollectionNode(draft, node));
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
      return;
    }
    selectNodes([node.id]);
    setEditingCollectionId(node.id);
  }

  function addNode(kind: 'variable' | 'group') {
    if (readOnly) {
      message.warning('当前标签页为只读');
      return;
    }
    const position = nextNodePosition(project);
    let node: AnyNode;
    if (kind === 'group') {
      node = createGroupNode(uniqueNodeName(project, '分组'), position);
    } else {
      // Every quantity starts as a free input. Its relation is written in the
      // outer relations panel, which turns it into a formula.
      node = createVariableNode(uniqueNodeName(project, '变量'), position, {
        variableKind: 'constant',
        role: 'input',
        value: 0,
      });
    }
    const fieldConflict = findFieldConflictForVariable(project, node.name);
    if (fieldConflict) {
      message.error(fieldConflict);
      return;
    }
    runCommand(kind === 'group' ? '新建分组' : '新建变量', (draft) => {
      draft.nodes[node.id] = node;
      draft.updatedAt = Date.now();
    });
    selectNodes([node.id]);
  }

  const eligibleSelection = useMemo(
    () =>
      selectedNodeIds.filter((nodeId) => {
        const node = project.nodes[nodeId];
        if (!node || node.kind !== 'variable') return false;
        if (node.variableKind !== 'constant' && node.variableKind !== 'formula') return false;
        return !project.bundles.some((bundle) => bundle.memberIds.includes(nodeId));
      }),
    [selectedNodeIds, project.nodes, project.bundles],
  );

  function openPackDialog() {
    if (readOnly) {
      message.warning('当前标签页为只读');
      return;
    }
    if (eligibleSelection.length === 0) {
      message.warning('请先选中常量或公式变量（已打包的变量不能重复打包）');
      return;
    }
    setPackName(`折叠包${project.bundles.length + 1}`);
    setPackMode('none');
    setPackMemberId(eligibleSelection[0]);
    setPackOpen(true);
  }

  function handlePack() {
    const name = packName.trim();
    if (!name) {
      message.error('请输入折叠包名称');
      return;
    }
    if (packMode === 'member' && !packMemberId) {
      message.error('请选择用于展示汇总结果的成员');
      return;
    }
    let createdId = '';
    try {
      runCommand('打包为折叠包', (draft) => {
        const bundle = createBundle(draft, name, eligibleSelection);
        bundle.summary =
          packMode === 'member'
            ? { mode: 'member', memberId: packMemberId }
            : { mode: packMode };
        createdId = bundle.id;
      });
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
      return;
    }
    if (createdId) {
      setBundleCollapsed(createdId, true);
      selectBundle(createdId);
    }
    setPackOpen(false);
  }

  function autoArrange() {
    if (readOnly) return;
    const variables = Object.values(project.nodes).filter(
      (node) => node.kind === 'variable',
    );
    const graph = buildDependencyGraph(project);
    const levels = new Map<NodeId, number>();
    for (const node of variables) levels.set(node.id, 0);
    for (let pass = 0; pass < variables.length + 2; pass += 1) {
      let changed = false;
      for (const node of variables) {
        if (node.variableKind !== 'formula') continue;
        let next = 0;
        for (const dep of graph.dependencies.get(node.id) ?? []) {
          next = Math.max(next, (levels.get(dep) ?? 0) + 1);
        }
        if (next > (levels.get(node.id) ?? 0)) {
          levels.set(node.id, next);
          changed = true;
        }
      }
      if (!changed) break;
    }
    const moves: Record<NodeId, Vec2> = {};
    const groups = Object.values(project.nodes).filter((node) => node.kind === 'group');
    groups.forEach((node, index) => {
      moves[node.id] = { x: -360, y: 40 + index * 118 };
    });
    const collections = Object.values(project.nodes).filter((node) => node.kind === 'collection');
    collections.forEach((node, index) => {
      moves[node.id] = { x: -360, y: 40 + (groups.length + index) * 118 };
    });
    const byLevel = new Map<number, typeof variables>();
    for (const node of variables) {
      const level = levels.get(node.id) ?? 0;
      const list = byLevel.get(level) ?? [];
      list.push(node);
      byLevel.set(level, list);
    }
    for (const [level, nodes] of byLevel) {
      nodes.sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'));
      nodes.forEach((node, index) => {
        moves[node.id] = {
          x: 40 + level * 300,
          y: (index - (nodes.length - 1) / 2) * 132,
        };
      });
    }
    runCommand('自动排列', (draft) => moveNodes(draft, moves));
  }

  const hasNodes = Object.keys(project.nodes).length > 0;

  return (
    <div className={styles.wrapper}>
      <div className={styles.toolbar}>
        <Tooltip title="新建数值量：公式写在「关系结构」里，画布只显示量">
          <Button size="small" icon={<PlusOutlined />} disabled={readOnly} onClick={() => addNode('variable')}>
            变量
          </Button>
        </Tooltip>
        <Dropdown
          disabled={readOnly}
          menu={{
            items: [
              { key: 'group', icon: <FolderOutlined />, label: '分组（仅用于组织，不参与计算）' },
              { key: 'collection', icon: <TableOutlined />, label: '数据表（批量多行数据）' },
            ],
            onClick: ({ key }) => {
              if (key === 'group') addNode('group');
              else if (key === 'collection') addCollection();
            },
          }}
        >
          <Button size="small" disabled={readOnly}>
            更多 <DownOutlined />
          </Button>
        </Dropdown>
        <Tooltip title="把选中的变量打包成可独立折叠的包">
          <Button
            size="small"
            icon={<InboxOutlined />}
            disabled={readOnly || eligibleSelection.length === 0}
            onClick={openPackDialog}
          >
            打包
          </Button>
        </Tooltip>
        <Tooltip title="按依赖层级自动排列画布节点">
          <Button size="small" icon={<ApartmentOutlined />} disabled={readOnly || !hasNodes} onClick={autoArrange}>
            整理
          </Button>
        </Tooltip>
        <Segmented
          size="small"
          value={edgeFilter}
          onChange={(value) => setEdgeFilter(value as EdgeFilter)}
          options={[
            { label: '全部', value: 'all' },
            { label: '归属', value: 'hierarchy' },
            { label: '依赖', value: 'dependency' },
            { label: '影响', value: 'influence' },
          ]}
        />
      </div>

      {!hasNodes && (
        <div className={styles.empty}>
          画布还是空的
          <br />
          点左上角「变量」新建数值量，到「关系结构」写公式，画布会自动生成箭头
        </div>
      )}

      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onSelectionChange={onSelectionChange}
        onEdgeClick={onEdgeClick}
        onConnect={onConnect}
        onNodeDragStart={onNodeDragStart}
        onNodeDragStop={onNodeDragStop}
        onNodeDoubleClick={(_event, clicked) => {
          const target = project.nodes[clicked.id];
          if (target?.kind !== 'collection') return;
          selectNodes([target.id]);
          setEditingCollectionId(target.id);
        }}
        deleteKeyCode={null}
        selectionOnDrag
        fitView
        fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
        minZoom={0.2}
        maxZoom={2.5}
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{ type: 'default' }}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="#1a2734" />
        <Controls showInteractive={false} />
        <MiniMap
          pannable
          zoomable
          nodeColor={(node) => {
            if (node.type === 'bundle') return '#2a5c8f';
            return node.type === 'group' ? '#5c4a8f' : '#2c4a66';
          }}
          maskColor="rgba(8, 12, 17, 0.78)"
        />
      </ReactFlow>

      <div className={styles.legend}>
        {(
          [
            ['all', '全部', ''],
            ['hierarchy', '归属', `#8b93a7`],
            ['dependency', '依赖', `#4f9dff`],
            ['influence', '影响', `#e8b45a`],
          ] as const
        ).map(([value, label, color]) => {
          const count =
            value === 'all'
              ? undefined
              : value === 'hierarchy'
                ? Object.values(project.nodes).filter((node) => node.parentId).length
                : value === 'dependency'
                  ? evaluation.dependencyEdges.length + collectionDeps.length
                  : project.relations.length;
          const active = edgeFilter === value;
          return (
            <button
              key={value}
              type="button"
              className={`${styles.legendItem} ${active ? styles.legendItemActive : ''}`}
              title={value === 'all' ? '显示全部关系' : `只看${label}关系（再点一次恢复全部）`}
              onClick={() => setEdgeFilter(active && value !== 'all' ? 'all' : (value as EdgeFilter))}
            >
              {color ? (
                <span
                  className={styles.legendSwatch}
                  style={{
                    background: color,
                    opacity: value === 'influence' ? 0.8 : 1,
                  }}
                />
              ) : null}
              {label}
              {typeof count === 'number' ? <span className={styles.legendCount}>{count}</span> : null}
            </button>
          );
        })}
      </div>

      <div className={styles.hint}>
        拖拽移动 · 点依赖箭头跳到「关系结构」 · 拖影响端口建关系 · Delete 删除选中 · Ctrl+Z 撤销
      </div>

      <Modal
        title="打包为折叠包"
        open={packOpen}
        onCancel={() => setPackOpen(false)}
        onOk={handlePack}
        okText="打包并折叠"
        cancelText="取消"
        destroyOnClose
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 4 }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>名称</div>
            <Input value={packName} onChange={(event) => setPackName(event.target.value)} />
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>汇总方式</div>
            <Select
              value={packMode}
              style={{ width: '100%' }}
              onChange={(value) => setPackMode(value as BundleSummaryMode)}
              options={[
                { value: 'none', label: '仅显示成员数量' },
                { value: 'product', label: '乘积（适合乘区）' },
                { value: 'sum', label: '求和' },
                { value: 'avg', label: '平均' },
                { value: 'min', label: '最小值' },
                { value: 'max', label: '最大值' },
                { value: 'member', label: '显示指定成员的值' },
              ]}
            />
          </div>
          {packMode === 'member' ? (
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>汇总成员</div>
              <Select
                value={packMemberId}
                style={{ width: '100%' }}
                onChange={setPackMemberId}
                options={eligibleSelection.map((nodeId) => ({
                  value: nodeId,
                  label: project.nodes[nodeId]?.label ?? nodeId,
                }))}
              />
            </div>
          ) : null}
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            将打包 {eligibleSelection.length} 个变量：
            {eligibleSelection
              .map((nodeId) => project.nodes[nodeId]?.label ?? nodeId)
              .join('、')}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            折叠包只改变显示，不改变计算依赖；每个包可以单独展开或收起。
          </div>
        </div>
      </Modal>
    </div>
  );
}
