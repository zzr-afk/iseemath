import { useEffect, useMemo, useState } from 'react';
import { Button, Empty, Input, Tag } from 'antd';
import { AimOutlined, MenuFoldOutlined, MenuUnfoldOutlined } from '@ant-design/icons';
import {
  Background,
  Controls,
  MarkerType,
  ReactFlow,
  type Edge,
  type Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useProjectStore } from '@/stores/projectStore';
import { useRuntimeStore } from '@/stores/runtimeStore';
import { useUiStore } from '@/stores/uiStore';
import { buildDependencyGraph } from '@/core/graph/dependency';
import { formatNumber } from '@/utils/format';
import type { NodeId, VariableNode } from '@/core/model/types';

const DEPTH = 2;
const NODE_W = 210;
const COL_GAP = 285;
const ROW_GAP = 118;

function collect(
  start: NodeId,
  graph: Map<NodeId, NodeId[]>,
): Map<NodeId, number> {
  const seen = new Map<NodeId, number>();
  let frontier = [start];
  for (let depth = 1; depth <= DEPTH; depth += 1) {
    const next: NodeId[] = [];
    for (const id of frontier) {
      for (const linked of graph.get(id) ?? []) {
        if (linked === start || seen.has(linked)) continue;
        seen.set(linked, depth);
        next.push(linked);
      }
    }
    frontier = next;
  }
  return seen;
}

export default function DataListWorkspace() {
  const project = useProjectStore((state) => state.project);
  const values = useRuntimeStore((state) => state.values);
  const errors = useRuntimeStore((state) => state.errors);
  const selectNodes = useUiStore((state) => state.selectNodes);
  const setActiveTab = useUiStore((state) => state.setActiveTab);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<NodeId | null>(null);
  const [listOpen, setListOpen] = useState(true);

  const variables = useMemo(
    () =>
      Object.values(project.nodes)
        .filter((node): node is VariableNode => node.kind === 'variable')
        .sort((a, b) => a.label.localeCompare(b.label, 'zh-CN')),
    [project.nodes],
  );

  useEffect(() => {
    if (selectedId && project.nodes[selectedId]) return;
    setSelectedId(variables[0]?.id ?? null);
  }, [project.nodes, selectedId, variables]);

  const selected = selectedId ? project.nodes[selectedId] : undefined;
  const graph = useMemo(() => buildDependencyGraph(project), [project]);
  const children = useMemo(() => {
    const map = new Map<NodeId, NodeId[]>();
    for (const [source, deps] of graph.dependencies) {
      for (const target of deps) {
        const list = map.get(target) ?? [];
        list.push(source);
        map.set(target, list);
      }
    }
    return map;
  }, [graph.dependencies]);

  const local = useMemo(() => {
    if (!selectedId) return null;
    const up = collect(selectedId, graph.dependencies);
    const down = collect(selectedId, children);
    for (const id of up.keys()) down.delete(id);
    return { up, down };
  }, [children, graph.dependencies, selectedId]);

  const filtered = useMemo(() => {
    const text = query.trim().toLocaleLowerCase();
    if (!text) return variables;
    return variables.filter(
      (node) =>
        node.label.toLocaleLowerCase().includes(text) ||
        node.name.toLocaleLowerCase().includes(text),
    );
  }, [query, variables]);

  const groups = useMemo(
    () =>
      Object.values(project.nodes)
        .filter((node) => node.kind === 'group')
        .sort((a, b) => a.label.localeCompare(b.label, 'zh-CN')),
    [project.nodes],
  );

  const sections = useMemo(() => {
    const result = groups.map((group) => ({
      id: group.id,
      label: group.label,
      nodes: filtered.filter((node) => node.parentId === group.id),
    }));
    const root = filtered.filter((node) => !node.parentId || !project.nodes[node.parentId]);
    return [...result.filter((section) => section.nodes.length > 0), { id: 'root', label: '未分组', nodes: root }]
      .filter((section) => section.nodes.length > 0);
  }, [filtered, groups, project.nodes]);

  const flow = useMemo(() => {
    if (!selectedId || !selected || !local) return { nodes: [] as Node[], edges: [] as Edge[] };
    const byColumn = new Map<number, NodeId[]>();
    const place = (id: NodeId, column: number) => {
      const list = byColumn.get(column) ?? [];
      if (!list.includes(id)) list.push(id);
      byColumn.set(column, list);
    };
    for (const [id, depth] of local.up) place(id, -depth);
    place(selectedId, 0);
    for (const [id, depth] of local.down) place(id, depth);

    const nodes: Node[] = [];
    const ids = new Set<NodeId>([selectedId, ...local.up.keys(), ...local.down.keys()]);
    for (const [column, columnIds] of byColumn) {
      columnIds.sort((a, b) => {
        const na = project.nodes[a];
        const nb = project.nodes[b];
        return (na?.label ?? '').localeCompare(nb?.label ?? '', 'zh-CN');
      });
      columnIds.forEach((id, index) => {
        const node = project.nodes[id];
        if (!node || node.kind !== 'variable') return;
        const isCenter = id === selectedId;
        const isUp = local.up.has(id);
        const isDown = local.down.has(id);
        const border = isCenter ? '#58c4ff' : isUp ? '#7f93a8' : isDown ? '#8b7bff' : '#3a4658';
        nodes.push({
          id,
          position: {
            x: 360 + column * COL_GAP,
            y: (index - (columnIds.length - 1) / 2) * ROW_GAP,
          },
          data: {
            label: `${node.label}\n${node.name} = ${formatNumber(values[id])}`,
          },
          style: {
            width: NODE_W,
            whiteSpace: 'pre-line',
            textAlign: 'left',
            fontSize: 12,
            lineHeight: 1.45,
            padding: '9px 11px',
            borderRadius: 9,
            border: `1px solid ${border}`,
            background: isCenter ? 'rgba(88,196,255,.16)' : isUp ? 'rgba(127,147,168,.12)' : 'rgba(139,123,255,.10)',
            color: 'var(--text-primary)',
          },
        });
      });
    }

    const edges: Edge[] = [];
    for (const [source, deps] of graph.dependencies) {
      if (!ids.has(source)) continue;
      for (const target of deps) {
        if (!ids.has(target)) continue;
        edges.push({
          id: `${source}->${target}`,
          source,
          target,
          markerEnd: { type: MarkerType.ArrowClosed },
          style: { stroke: '#58c4ff', strokeWidth: 1.5 },
        });
      }
    }
    return { nodes, edges };
  }, [graph.dependencies, local, project.nodes, selected, selectedId, values]);

  function choose(id: NodeId) {
    setSelectedId(id);
    selectNodes([id]);
  }

  function locateInCanvas() {
    if (!selectedId) return;
    selectNodes([selectedId]);
    setActiveTab('canvas');
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: listOpen ? '230px minmax(0,1fr)' : 'minmax(0,1fr)', gap: 14, width: '100%', maxWidth: 1180, margin: '0 auto', height: 'calc(100vh - 260px)', minHeight: 520, maxHeight: 760 }}>
      {listOpen && (
      <section style={{ border: '1px solid var(--border-subtle)', borderRadius: 12, background: 'var(--bg-panel)', overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div style={{ padding: 10, borderBottom: '1px solid var(--border-subtle)', display: 'flex', gap: 6, alignItems: 'center' }}>
          <Button size="small" type="text" icon={<MenuFoldOutlined />} onClick={() => setListOpen(false)} title="收起列表" />
          <Input.Search
            allowClear
            style={{ flex: 1 }}
            placeholder="搜索量名 / 变量名"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div style={{ overflow: 'auto', padding: 8, flex: 1, minHeight: 0 }}>
          {sections.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有匹配的量" />
          ) : (
            sections.map((section) => (
              <div key={section.id} style={{ marginBottom: 10 }}>
                <div style={{ padding: '6px 8px', color: 'var(--text-muted)', fontSize: 11 }}>{section.label}</div>
                {section.nodes.map((node) => {
                  const active = node.id === selectedId;
                  const error = errors[node.id];
                  return (
                    <button
                      key={node.id}
                      type="button"
                      onClick={() => choose(node.id)}
                      style={{
                        width: '100%',
                        display: 'grid',
                        gridTemplateColumns: 'minmax(0,1fr) auto',
                        gap: 8,
                        alignItems: 'center',
                        padding: '7px 9px',
                        marginBottom: 2,
                        borderRadius: 7,
                        border: active ? '1px solid rgba(88,196,255,.55)' : '1px solid transparent',
                        background: active ? 'var(--accent-soft)' : 'transparent',
                        color: error ? 'var(--danger)' : 'var(--text-primary)',
                        cursor: 'pointer',
                        textAlign: 'left',
                      }}
                    >
                      <span style={{ overflow: 'hidden' }}>
                        <span style={{ display: 'block', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.label}</span>
                        <span style={{ display: 'block', fontSize: 10, color: 'var(--text-muted)', fontFamily: 'ui-monospace, Menlo, monospace' }}>{node.name}</span>
                      </span>
                      <span style={{ fontSize: 11, fontFamily: 'ui-monospace, Menlo, monospace', color: error ? 'var(--danger)' : 'var(--text-secondary)' }}>
                        {error ? '错误' : formatNumber(values[node.id])}
                      </span>
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </section>
      )}

      <section style={{ border: '1px solid var(--border-subtle)', borderRadius: 12, background: 'var(--bg-panel)', overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div style={{ padding: '11px 14px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {selected ? selected.label : '选择一个量'}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
              {selected ? `${selected.name} = ${formatNumber(values[selected.id])}` : '左侧点击一个量，查看它的上下游'}
            </div>
          </div>
          <Tag color="blue">上游</Tag>
          <Tag color="purple">下游</Tag>
          {!listOpen && (
            <Button size="small" type="text" icon={<MenuUnfoldOutlined />} onClick={() => setListOpen(true)} title="显示列表" />
          )}
          <Button size="small" icon={<AimOutlined />} disabled={!selectedId} onClick={locateInCanvas}>
            在画布中定位
          </Button>
        </div>
        <div style={{ flex: 1, minHeight: 0 }}>
          {flow.nodes.length === 0 ? (
            <Empty style={{ marginTop: 90 }} description="选择一个量" />
          ) : (
            <ReactFlow
              key={selectedId}
              nodes={flow.nodes}
              edges={flow.edges}
              fitView
              fitViewOptions={{ padding: 0.28 }}
              nodesDraggable={false}
              nodesConnectable={false}
              elementsSelectable
              onNodeClick={(_, node) => choose(node.id)}
            >
              <Background gap={20} />
              <Controls showInteractive={false} />
            </ReactFlow>
          )}
        </div>
      </section>
    </div>
  );
}
