import { useMemo } from 'react';
import { message } from 'antd';
import type { AnyNode, NodeId } from '@/core/model/types';
import { setNodeParent } from '@/core/model/commands';
import { useProjectStore } from '@/stores/projectStore';
import { useUiStore } from '@/stores/uiStore';
import { useRuntimeStore } from '@/stores/runtimeStore';

interface TreeItemProps {
  node: AnyNode;
  depth: number;
  nodes: Record<NodeId, AnyNode>;
  selectedIds: NodeId[];
  onSelect: (id: NodeId, additive: boolean) => void;
  onDropNode: (draggedId: NodeId, targetId: NodeId | null) => void;
  readOnly: boolean;
  errors: Record<NodeId, string | undefined>;
}

function TreeItem({
  node,
  depth,
  nodes,
  selectedIds,
  onSelect,
  onDropNode,
  readOnly,
  errors,
}: TreeItemProps) {
  const children = Object.values(nodes).filter((item) => item.parentId === node.id);
  const selected = selectedIds.includes(node.id);
  const isGroup = node.kind === 'group';

  return (
    <div>
      <button
        type="button"
        draggable={!readOnly}
        onClick={(event) =>
          onSelect(node.id, event.shiftKey || event.ctrlKey || event.metaKey)
        }
        onDragStart={(event) => {
          event.dataTransfer.setData('application/x-iseemath-node', node.id);
          event.dataTransfer.effectAllowed = 'move';
        }}
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes('application/x-iseemath-node')) {
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
          }
        }}
        onDrop={(event) => {
          event.preventDefault();
          event.stopPropagation();
          const draggedId = event.dataTransfer.getData('application/x-iseemath-node');
          if (draggedId) onDropNode(draggedId, node.id);
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 7,
          width: '100%',
          padding: '6px 12px 6px',
          paddingLeft: 12 + depth * 14,
          background: selected ? 'var(--accent-soft)' : 'transparent',
          border: 'none',
          borderLeft: selected ? '2px solid var(--accent)' : '2px solid transparent',
          color: errors[node.id] ? 'var(--danger)' : 'var(--text-primary)',
          cursor: 'pointer',
          textAlign: 'left',
          fontSize: 12,
        }}
      >
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: isGroup ? 2 : '50%',
            background: isGroup ? '#9b7bff' : 'var(--accent)',
            flex: '0 0 auto',
            opacity: 0.9,
          }}
        />
        <span
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontWeight: isGroup ? 600 : 400,
          }}
        >
          {node.label}
        </span>
        <span
          style={{
            marginLeft: 'auto',
            color: 'var(--text-muted)',
            fontSize: 10,
            fontFamily: 'ui-monospace, Menlo, monospace',
          }}
        >
          {node.name}
        </span>
      </button>
      {children.map((child) => (
        <TreeItem
          key={child.id}
          node={child}
          depth={depth + 1}
          nodes={nodes}
          selectedIds={selectedIds}
          onSelect={onSelect}
          onDropNode={onDropNode}
          readOnly={readOnly}
          errors={errors}
        />
      ))}
    </div>
  );
}

export default function VariableTree() {
  const project = useProjectStore((state) => state.project);
  const selectedIds = useUiStore((state) => state.selectedNodeIds);
  const selectNodes = useUiStore((state) => state.selectNodes);
  const toggleSelected = useUiStore((state) => state.toggleSelected);
  const selectBundle = useUiStore((state) => state.selectBundle);
  const runCommand = useProjectStore((state) => state.runCommand);
  const readOnly = useProjectStore((state) => state.readOnly);
  const errors = useRuntimeStore((state) => state.errors);

  function handleSelect(id: NodeId, additive: boolean) {
    selectBundle(null);
    if (additive) toggleSelected(id, true);
    else selectNodes([id]);
  }

  function handleDropNode(draggedId: NodeId, targetId: NodeId | null) {
    if (readOnly) {
      message.warning('当前标签页为只读');
      return;
    }
    if (draggedId === targetId) return;
    try {
      runCommand('修改归属', (draft) => setNodeParent(draft, draggedId, targetId));
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  }

  const roots = useMemo<AnyNode[]>(() => {
    const values = Object.values(project.nodes);
    return values
      .filter((node) => node.parentId === null)
      .sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === 'group' ? -1 : 1;
        return a.createdAt - b.createdAt;
      });
  }, [project.nodes]);

  return (
    <div
      style={{ paddingBottom: 24 }}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes('application/x-iseemath-node')) {
          event.preventDefault();
        }
      }}
      onDrop={(event) => {
        event.preventDefault();
        const draggedId = event.dataTransfer.getData('application/x-iseemath-node');
        if (draggedId) handleDropNode(draggedId, null);
      }}
    >
      {roots.length === 0 ? (
        <div style={{ padding: '8px 12px', color: 'var(--text-muted)', fontSize: 12 }}>
          还没有变量。在画布中新建，或稍后用 JSON 导入模型。
        </div>
      ) : (
        <>
          {roots.map((node) => (
            <TreeItem
              key={node.id}
              node={node}
              depth={0}
              nodes={project.nodes}
              selectedIds={selectedIds}
              onSelect={handleSelect}
              onDropNode={handleDropNode}
              readOnly={readOnly}
              errors={errors}
            />
          ))}
          <div style={{ padding: '6px 12px', color: 'var(--text-muted)', fontSize: 10 }}>
            拖到其他节点上可改归属，拖到空白处设为根节点
          </div>
        </>
      )}
    </div>
  );
}
