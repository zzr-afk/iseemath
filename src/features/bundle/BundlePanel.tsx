import { useEffect, useState } from 'react';
import { Button, Empty, Input, Modal, Select, Switch, Tag, Tooltip, message } from 'antd';
import { EditOutlined, InboxOutlined } from '@ant-design/icons';
import { useProjectStore } from '@/stores/projectStore';
import { useRuntimeStore } from '@/stores/runtimeStore';
import { useViewStore } from '@/stores/viewStore';
import { useUiStore } from '@/stores/uiStore';
import { dissolveBundle, updateBundle, updateBundleSummary } from '@/core/model/commands';
import { summarizeBundle } from '@/core/graph/bundles';
import type { Bundle, BundleSummaryMode } from '@/core/model/types';

export default function BundlePanel() {
  const project = useProjectStore((state) => state.project);
  const runCommand = useProjectStore((state) => state.runCommand);
  const values = useRuntimeStore((state) => state.values);
  const errors = useRuntimeStore((state) => state.errors);
  const viewState = useViewStore((state) => state.viewState);
  const setBundleCollapsed = useViewStore((state) => state.setBundleCollapsed);
  const selectedBundleId = useUiStore((state) => state.selectedBundleId);
  const selectBundle = useUiStore((state) => state.selectBundle);

  const [editing, setEditing] = useState<Bundle | null>(null);
  const [editName, setEditName] = useState('');
  const [editMode, setEditMode] = useState<BundleSummaryMode>('none');
  const [editMemberId, setEditMemberId] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!editing) return;
    setEditName(editing.name);
    setEditMode(editing.summary.mode);
    setEditMemberId(
      editing.summary.memberId ??
        editing.memberIds.find((memberId) => project.nodes[memberId]) ??
        undefined,
    );
  }, [editing, project.nodes]);

  function openEditor(bundle: Bundle) {
    setEditing(bundle);
  }

  function saveEditor() {
    if (!editing) return;
    const name = editName.trim();
    if (!name) {
      message.error('名称不能为空');
      return;
    }
    if (editMode === 'member' && !editMemberId) {
      message.error('请选择汇总成员');
      return;
    }
    try {
      runCommand('编辑折叠包', (draft) => {
        updateBundle(draft, editing.id, { name });
        updateBundleSummary(
          draft,
          editing.id,
          editMode === 'member'
            ? { mode: 'member', memberId: editMemberId }
            : { mode: editMode },
        );
      });
      setEditing(null);
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  }

  if (project.bundles.length === 0) {
    return (
      <div style={{ padding: '4px 12px 12px' }}>
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>
              多选变量后点“打包”，可把乘区等一组量折叠起来
            </span>
          }
        />
      </div>
    );
  }

  return (
    <div style={{ padding: '0 8px 14px' }}>
      {project.bundles.map((bundle) => {
        const collapsed = Boolean(viewState.bundleCollapsed[bundle.id]);
        const summary = summarizeBundle(bundle, values, errors);
        const selected = selectedBundleId === bundle.id;
        return (
          <div
            key={bundle.id}
            onClick={() => selectBundle(bundle.id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              padding: '6px 6px',
              borderRadius: 6,
              cursor: 'pointer',
              background: selected ? 'var(--accent-soft)' : 'transparent',
            }}
          >
            <InboxOutlined style={{ color: bundle.color ?? '#67b7ff', fontSize: 13 }} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div
                style={{
                  fontSize: 12,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
                title={bundle.name}
              >
                {bundle.name}
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                {bundle.memberIds.length} 项 · {summary.text}
              </div>
            </div>
            {summary.errorCount > 0 ? (
              <Tag bordered={false} color="error" style={{ marginInlineEnd: 0, fontSize: 10 }}>
                {summary.errorCount} 错
              </Tag>
            ) : null}
            <Tooltip title={collapsed ? '展开' : '收起'}>
              <Switch
                size="small"
                checked={!collapsed}
                onChange={(checked) => setBundleCollapsed(bundle.id, !checked)}
                onClick={(_, event) => event.stopPropagation()}
              />
            </Tooltip>
            <Button
              size="small"
              type="text"
              icon={<EditOutlined />}
              style={{ width: 20, height: 20, minWidth: 20 }}
              onClick={(event) => {
                event.stopPropagation();
                openEditor(bundle);
              }}
            />
          </div>
        );
      })}

      <Modal
        open={editing !== null}
        title="编辑折叠包"
        onCancel={() => setEditing(null)}
        onOk={saveEditor}
        okText="保存"
        cancelText="取消"
      >
        {editing ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 4 }}>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>名称</div>
              <Input value={editName} onChange={(event) => setEditName(event.target.value)} />
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>汇总方式</div>
              <Select
                value={editMode}
                style={{ width: '100%' }}
                onChange={(value) => setEditMode(value as BundleSummaryMode)}
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
            {editMode === 'member' ? (
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
                  汇总成员
                </div>
                <Select
                  value={editMemberId}
                  style={{ width: '100%' }}
                  onChange={setEditMemberId}
                  options={editing.memberIds.map((memberId) => ({
                    value: memberId,
                    label: project.nodes[memberId]?.label ?? memberId,
                  }))}
                />
              </div>
            ) : null}
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              成员：{editing.memberIds.map((id) => project.nodes[id]?.label ?? id).join('、')}
            </div>
            <div>
              <Button
                danger
                size="small"
                onClick={() => {
                  try {
                    runCommand('解散折叠包', (draft) => dissolveBundle(draft, editing.id));
                    setBundleCollapsed(editing.id, false);
                    setEditing(null);
                    selectBundle(null);
                  } catch (error) {
                    message.error(error instanceof Error ? error.message : String(error));
                  }
                }}
              >
                解散折叠包（保留成员）
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
