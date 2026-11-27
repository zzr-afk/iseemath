import { useEffect, useMemo, useState } from 'react';
import { Button, Divider, Empty, Input, InputNumber, Select, Tag, Typography, message } from 'antd';
import { DeleteOutlined } from '@ant-design/icons';
import { useProjectStore } from '@/stores/projectStore';
import { useUiStore } from '@/stores/uiStore';
import { useRuntimeStore } from '@/stores/runtimeStore';
import {
  deleteNode,
  dissolveBundle,
  setCollectionDataset,
  setNodeParent,
  updateBundleSummary,
  updateNode,
} from '@/core/model/commands';
import { descendantIds } from '@/core/model/invariants';
import { summarizeBundle } from '@/core/graph/bundles';
import { useViewStore } from '@/stores/viewStore';
import type {
  Bundle,
  BundleSummaryMode,
  NodeId,
  VariableRole,
} from '@/core/model/types';

const { Text } = Typography;

function uniqueAmongSiblings(
  project: ReturnType<typeof useProjectStore.getState>['project'],
  name: string,
  selfId: NodeId | null,
  kind: 'variable' | 'group' | 'collection' | null,
): boolean {
  if (!kind) return true;
  const lower = name.toLocaleLowerCase();
  return !Object.values(project.nodes).some(
    (node) => node.kind === kind && node.id !== selfId && node.name.toLocaleLowerCase() === lower,
  );
}

function BundleInspector({ bundle }: { bundle: Bundle }) {
  const project = useProjectStore((state) => state.project);
  const runCommand = useProjectStore((state) => state.runCommand);
  const selectNodes = useUiStore((state) => state.selectNodes);
  const values = useRuntimeStore((state) => state.values);
  const errors = useRuntimeStore((state) => state.errors);
  const collapsed = useViewStore((state) => state.viewState.bundleCollapsed[bundle.id]);
  const setBundleCollapsed = useViewStore((state) => state.setBundleCollapsed);
  const summary = summarizeBundle(bundle, values, errors);

  return (
    <div style={{ padding: '14px 14px 32px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Text strong style={{ fontSize: 13 }}>
          折叠包
        </Text>
        <Tag bordered={false} color="blue">
          视图
        </Tag>
      </div>

      <div
        style={{
          marginTop: 10,
          padding: '6px 8px',
          borderRadius: 6,
          background: 'var(--bg-elevated)',
          fontVariantNumeric: 'tabular-nums',
          fontSize: 18,
          fontWeight: 600,
          color: summary.errorCount > 0 ? 'var(--danger)' : undefined,
        }}
      >
        {summary.text}
      </div>

      <Divider style={{ margin: '14px 0 10px' }} />

      <div style={{ fontSize: 13, fontWeight: 600 }}>{bundle.name}</div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
        折叠包只改变显示，不参与计算。汇总结果不能被公式引用。
      </div>

      <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginTop: 12 }}>
        汇总方式
      </label>
      <Select
        size="small"
        value={bundle.summary.mode}
        style={{ width: '100%', marginTop: 4 }}
        onChange={(mode) => {
          try {
            runCommand('修改包汇总方式', (draft) =>
              updateBundleSummary(
                draft,
                bundle.id,
                mode === 'member'
                  ? { mode: 'member', memberId: bundle.memberIds[0] }
                  : { mode: mode as BundleSummaryMode },
              ),
            );
          } catch (error) {
            message.error(error instanceof Error ? error.message : String(error));
          }
        }}
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

      <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginTop: 12 }}>
        成员（{bundle.memberIds.length}）
      </label>
      <div style={{ marginTop: 4 }}>
        {bundle.memberIds.map((memberId) => {
          const member = project.nodes[memberId];
          const value = values[memberId];
          const error = errors[memberId];
          return (
            <button
              key={memberId}
              type="button"
              onClick={() => selectNodes([memberId])}
              style={{
                display: 'flex',
                width: '100%',
                alignItems: 'center',
                gap: 8,
                padding: '3px 0',
                background: 'none',
                border: 'none',
                color: error ? 'var(--danger)' : 'var(--text-secondary)',
                fontSize: 11.5,
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {member?.label ?? memberId}
              </span>
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                {error ? '错误' : value === undefined ? '—' : value}
              </span>
            </button>
          );
        })}
      </div>

      <Divider style={{ margin: '14px 0 10px' }} />

      <div style={{ display: 'flex', gap: 8 }}>
        <Button size="small" onClick={() => setBundleCollapsed(bundle.id, !collapsed)}>
          {collapsed ? '展开包' : '收起包'}
        </Button>
        <Button
          size="small"
          danger
          onClick={() => {
            runCommand('解散折叠包', (draft) => dissolveBundle(draft, bundle.id));
            setBundleCollapsed(bundle.id, false);
            selectNodes([]);
          }}
        >
          解包
        </Button>
      </div>
    </div>
  );
}

function BatchInspector() {
  const project = useProjectStore((state) => state.project);
  const runCommand = useProjectStore((state) => state.runCommand);
  const selectedIds = useUiStore((state) => state.selectedNodeIds);
  const selectNodes = useUiStore((state) => state.selectNodes);

  const [parentId, setParentId] = useState('__keep__');
  const [role, setRole] = useState<VariableRole>('input');
  const [unit, setUnit] = useState('');
  const [tags, setTags] = useState('');

  const nodes = selectedIds
    .map((nodeId) => project.nodes[nodeId])
    .filter((node): node is NonNullable<typeof node> => Boolean(node));
  const variableIds = nodes.filter((node) => node.kind === 'variable').map((node) => node.id);

  const parentOptions = useMemo(() => {
    const blocked = new Set<NodeId>(selectedIds);
    for (const nodeId of selectedIds) {
      for (const descendant of descendantIds(project, nodeId)) blocked.add(descendant);
    }
    return [
      { label: '（设为根节点）', value: '__root__' },
      ...Object.values(project.nodes)
        .filter((node) => !blocked.has(node.id))
        .map((node) => ({
          label: `${node.kind === 'group' ? '分组' : '变量'} · ${node.label}`,
          value: node.id,
        })),
    ];
  }, [project, selectedIds]);

  function commit(labelText: string, recipe: (draft: typeof project) => void) {
    try {
      runCommand(labelText, recipe);
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  }

  function applyParent() {
    if (parentId === '__keep__') return;
    const target = parentId === '__root__' ? null : parentId;
    commit('批量修改归属', (draft) => {
      for (const nodeId of selectedIds) setNodeParent(draft, nodeId, target);
    });
  }

  function applyRole() {
    if (variableIds.length === 0) return;
    commit('批量修改用途', (draft) => {
      for (const nodeId of variableIds) updateNode(draft, nodeId, { role });
    });
  }

  function applyUnit() {
    if (variableIds.length === 0) return;
    commit('批量修改单位', (draft) => {
      for (const nodeId of variableIds) updateNode(draft, nodeId, { unit });
    });
  }

  function applyTags() {
    const parsed = tags
      .split(/[,，\s]+/)
      .map((tag) => tag.trim())
      .filter(Boolean);
    if (parsed.length === 0) return;
    commit('批量追加标签', (draft) => {
      for (const node of nodes) {
        const current = draft.nodes[node.id];
        if (!current) continue;
        const next = Array.from(new Set([...current.tags, ...parsed]));
        if (next.length !== current.tags.length) {
          updateNode(draft, node.id, { tags: next });
        }
      }
    });
  }

  return (
    <div style={{ padding: '14px 14px 32px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Text strong style={{ fontSize: 13 }}>
          批量编辑
        </Text>
        <Tag bordered={false} color="blue">
          {selectedIds.length} 个节点
        </Tag>
      </div>
      <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.7 }}>
        {nodes.map((node) => node.label).join('、')}
      </div>

      <Divider style={{ margin: '14px 0 10px' }} />

      <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>归属上级</label>
      <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
        <Select
          size="small"
          value={parentId}
          options={[{ label: '（保持不变）', value: '__keep__' }, ...parentOptions]}
          onChange={setParentId}
          style={{ flex: 1 }}
        />
        <Button size="small" disabled={parentId === '__keep__'} onClick={applyParent}>
          应用
        </Button>
      </div>

      <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginTop: 12 }}>
        用途（仅变量）
      </label>
      <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
        <Select
          size="small"
          value={role}
          disabled={variableIds.length === 0}
          options={[
            { label: '输入', value: 'input' },
            { label: '中间量', value: 'intermediate' },
            { label: '输出', value: 'output' },
          ]}
          onChange={(value) => setRole(value as VariableRole)}
          style={{ flex: 1 }}
        />
        <Button size="small" disabled={variableIds.length === 0} onClick={applyRole}>
          应用
        </Button>
      </div>

      <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginTop: 12 }}>
        单位（仅变量）
      </label>
      <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
        <Input
          size="small"
          value={unit}
          placeholder="如：点 / % / 秒"
          disabled={variableIds.length === 0}
          onChange={(event) => setUnit(event.target.value)}
        />
        <Button size="small" disabled={variableIds.length === 0} onClick={applyUnit}>
          应用
        </Button>
      </div>

      <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginTop: 12 }}>
        追加标签
      </label>
      <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
        <Input
          size="small"
          value={tags}
          placeholder="用逗号分隔，如：乘区, 输出"
          onChange={(event) => setTags(event.target.value)}
        />
        <Button size="small" disabled={!tags.trim()} onClick={applyTags}>
          追加
        </Button>
      </div>

      <Divider style={{ margin: '14px 0 10px' }} />

      <Button
        size="small"
        danger
        block
        onClick={() => {
          commit('删除节点', (draft) => {
            for (const nodeId of selectedIds) deleteNode(draft, nodeId);
          });
          selectNodes([]);
        }}
      >
        删除选中的 {selectedIds.length} 个节点
      </Button>
    </div>
  );
}

function NodeInspector() {
  const project = useProjectStore((state) => state.project);
  const runCommand = useProjectStore((state) => state.runCommand);
  const selectedIds = useUiStore((state) => state.selectedNodeIds);
  const selectNodes = useUiStore((state) => state.selectNodes);
  const setEditingCollectionId = useUiStore((state) => state.setEditingCollectionId);
  const focusRelation = useUiStore((state) => state.focusRelation);
  const values = useRuntimeStore((state) => state.values);
  const errors = useRuntimeStore((state) => state.errors);

  const node = selectedIds.length === 1 ? project.nodes[selectedIds[0]!] : undefined;

  const [label, setLabel] = useState('');
  const [name, setName] = useState('');
  const [constantValue, setConstantValue] = useState<number>(0);

  useEffect(() => {
    if (!node) return;
    setLabel(node.label);
    setName(node.name);
    setConstantValue(node.kind === 'variable' ? (node.value ?? 0) : 0);
  }, [node]);

  const parentOptions = useMemo(() => {
    if (!node) return [];
    const blocked = descendantIds(project, node.id);
    return [
      { label: '（无上级）', value: '__root__' },
      ...Object.values(project.nodes)
        .filter((candidate) => candidate.id !== node.id && !blocked.has(candidate.id))
        .map((candidate) => ({
          label: `${candidate.kind === 'group' ? '分组' : '变量'} · ${candidate.label}`,
          value: candidate.id,
        })),
    ];
  }, [node, project]);

  if (!node) {
    return (
      <div style={{ padding: 20 }}>
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={<span style={{ color: 'var(--text-muted)' }}>选择一个节点查看属性</span>}
        />
      </div>
    );
  }

  function commitNode(patch: Parameters<typeof updateNode>[2], labelText: string) {
    if (!node) return;
    try {
      runCommand(labelText, (draft) => updateNode(draft, node.id, patch));
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  }

  function commitName() {
    if (!node) return;
    const trimmed = name.trim();
    if (!trimmed || trimmed === node.name) {
      setName(node.name);
      return;
    }
    if (!uniqueAmongSiblings(project, trimmed, node.id, node.kind)) {
      message.error('同一类节点中名称已存在');
      setName(node.name);
      return;
    }
    commitNode({ name: trimmed }, '修改变量名');
  }

  const value = values[node.id];
  const error = errors[node.id];
  const collectionDataset =
    node.kind === 'collection'
      ? project.datasets.find((candidate) => candidate.id === node.datasetId)
      : undefined;
  const derivedFieldCount =
    node.kind === 'collection'
      ? node.fields.filter((field) => field.role === 'derived').length
      : 0;

  return (
    <div style={{ padding: '14px 14px 32px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Text strong style={{ fontSize: 13 }}>
          {node.kind === 'group' ? '分组' : node.kind === 'collection' ? '数据表' : '变量'}
        </Text>
        <Tag bordered={false} color="blue">
          {node.kind === 'variable'
            ? node.variableKind === 'curve'
              ? '曲线'
              : node.variableKind === 'table'
                ? '表格'
                : '变量'
            : node.kind === 'collection'
              ? '批量'
              : node.kind}
        </Tag>
        <span style={{ flex: 1 }} />
        <Button
          size="small"
          type="text"
          danger
          icon={<DeleteOutlined />}
          onClick={() => {
            runCommand('删除节点', (draft) => deleteNode(draft, node.id));
            selectNodes([]);
          }}
        />
      </div>

      {error ? (
        <div
          style={{
            marginTop: 10,
            padding: '6px 8px',
            borderRadius: 6,
            background: 'rgba(241, 109, 109, 0.12)',
            color: 'var(--danger)',
            fontSize: 11.5,
          }}
        >
          {error}
        </div>
      ) : node.kind === 'variable' ? (
        <div
          style={{
            marginTop: 10,
            padding: '6px 8px',
            borderRadius: 6,
            background: 'var(--bg-elevated)',
            fontVariantNumeric: 'tabular-nums',
            fontSize: 18,
            fontWeight: 600,
          }}
        >
          {value === undefined ? '—' : value}
          {node.unit ? (
            <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 6 }}>{node.unit}</span>
          ) : null}
        </div>
      ) : null}

      <Divider style={{ margin: '14px 0 10px' }} />

      <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>展示名</label>
      <Input
        size="small"
        value={label}
        onChange={(event) => setLabel(event.target.value)}
        onBlur={() => {
          const trimmed = label.trim();
          if (!trimmed || trimmed === node.label) {
            setLabel(node.label);
            return;
          }
          commitNode({ label: trimmed }, '修改展示名');
        }}
        style={{ marginTop: 4 }}
      />

      <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginTop: 10 }}>
        符号名（用于公式）
      </label>
      <Input
        size="small"
        value={name}
        onChange={(event) => setName(event.target.value)}
        onBlur={commitName}
        status={uniqueAmongSiblings(project, name.trim(), node.id, node.kind) ? undefined : 'error'}
        style={{ marginTop: 4, fontFamily: 'ui-monospace, Menlo, monospace' }}
      />

      <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginTop: 10 }}>
        归属上级
      </label>
      <Select
        size="small"
        value={node.parentId ?? '__root__'}
        options={parentOptions}
        onChange={(value) => {
          try {
            runCommand('修改归属', (draft) =>
              setNodeParent(draft, node.id, value === '__root__' ? null : value),
            );
          } catch (err) {
            message.error(err instanceof Error ? err.message : String(err));
          }
        }}
        style={{ width: '100%', marginTop: 4 }}
      />

      {node.kind === 'collection' ? (
        <>
          <label
            style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginTop: 10 }}
          >
            绑定的数据集
          </label>
          <Select
            size="small"
            value={node.datasetId}
            options={project.datasets.map((candidate) => ({
              value: candidate.id,
              label: `${candidate.name}${candidate.dataUnavailable ? '（不可用）' : ''} · ${candidate.rowCount} 行`,
              disabled: candidate.dataUnavailable,
            }))}
            onChange={(datasetId) => {
              try {
                runCommand('切换数据表数据集', (draft) =>
                  setCollectionDataset(draft, node.id, datasetId),
                );
              } catch (err) {
                message.error(err instanceof Error ? err.message : String(err));
              }
            }}
            style={{ width: '100%', marginTop: 4 }}
          />
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.7 }}>
            {collectionDataset ? `${collectionDataset.rowCount} 行` : '未绑定数据集'} ·{' '}
            {node.fields.length} 个字段 · {derivedFieldCount} 个派生列
          </div>
          {node.dataMissing ? (
            <div style={{ fontSize: 11, color: 'var(--danger)', marginTop: 4 }}>
              数据缺失：字段映射或数据源不可用，批量求值已暂停
            </div>
          ) : null}
          <Button
            size="small"
            block
            style={{ marginTop: 8 }}
            onClick={() => setEditingCollectionId(node.id)}
          >
            打开数据表编辑器
          </Button>
        </>
      ) : null}

      {node.kind === 'variable' && node.variableKind === 'constant' ? (
        <>
          <label
            style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginTop: 10 }}
          >
            值
          </label>
          <InputNumber
            size="small"
            value={constantValue}
            onChange={(value) => setConstantValue(value ?? 0)}
            onBlur={() => {
              if (constantValue !== (node.value ?? 0)) {
                commitNode({ value: constantValue }, '修改输入值');
              }
            }}
            onPressEnter={() => {
              if (constantValue !== (node.value ?? 0)) {
                commitNode({ value: constantValue }, '修改输入值');
              }
            }}
            style={{ width: '100%', marginTop: 4 }}
          />
          <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 6, lineHeight: 1.6 }}>
            这是一个自由输入，可到「关系结构」标签页点「写关系」把它变成推导量。
          </div>
        </>
      ) : null}

      {node.kind === 'variable' && node.variableKind === 'formula' ? (
        <>
          <label
            style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginTop: 10 }}
          >
            关系式
          </label>
          <div
            style={{
              marginTop: 4,
              padding: '6px 8px',
              borderRadius: 6,
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border-subtle)',
              fontFamily: 'ui-monospace, Menlo, monospace',
              fontSize: 11.5,
              lineHeight: 1.6,
              color: node.formula?.trim() ? 'var(--text-primary)' : 'var(--text-muted)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {node.formula?.trim() || '（空公式）'}
          </div>
          <Button
            size="small"
            block
            style={{ marginTop: 6 }}
            onClick={() => focusRelation(node.id)}
          >
            在关系结构中编辑
          </Button>
          <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 6, lineHeight: 1.6 }}>
            所有公式统一写在「关系结构」标签页；画布箭头由公式自动生成。
          </div>
        </>
      ) : null}

      {node.kind === 'variable' ? (
        <>
          <label
            style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginTop: 10 }}
          >
            用途
          </label>
          <Select
            size="small"
            value={node.role}
            options={[
              { label: '输入', value: 'input' },
              { label: '中间量', value: 'intermediate' },
              { label: '输出', value: 'output' },
            ]}
            onChange={(role) => {
              try {
                runCommand('修改用途', (draft) => updateNode(draft, node.id, { role }));
              } catch (err) {
                message.error(err instanceof Error ? err.message : String(err));
              }
            }}
            style={{ width: '100%', marginTop: 4 }}
          />
          <label
            style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginTop: 10 }}
          >
            单位
          </label>
          <Input
            size="small"
            value={node.unit ?? ''}
            onChange={(event) => {
              const unit = event.target.value;
              runCommand('修改单位', (draft) => updateNode(draft, node.id, { unit }));
            }}
            placeholder="如：点 / % / 秒"
            style={{ marginTop: 4 }}
          />
        </>
      ) : null}
    </div>
  );
}

export default function InspectorPanel() {
  const project = useProjectStore((state) => state.project);
  const selectedBundleId = useUiStore((state) => state.selectedBundleId);
  const selectedIds = useUiStore((state) => state.selectedNodeIds);
  const selectedBundle = selectedBundleId
    ? project.bundles.find((bundle) => bundle.id === selectedBundleId)
    : undefined;
  if (selectedBundle) return <BundleInspector bundle={selectedBundle} />;
  if (selectedIds.length > 1) return <BatchInspector />;
  return <NodeInspector />;
}
