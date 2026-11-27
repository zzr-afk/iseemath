import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Divider,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { nanoid } from 'nanoid';
import { sliceTable, type ColumnarTable } from '@/core/logs/parse';
import { evaluateCollectionColumns } from '@/core/eval/batch';
import {
  analyzeCollectionFields,
  collectionBindingIssue,
  findFieldNameConflict,
  isNumericFieldType,
} from '@/core/model/collection';
import {
  addCollectionField,
  removeCollectionField,
  setCollectionDataset,
  updateCollectionField,
} from '@/core/model/commands';
import type { CollectionNode, DatasetMeta, FieldDef, FieldType, Project } from '@/core/model/types';
import { useProjectStore } from '@/stores/projectStore';
import { useRuntimeStore } from '@/stores/runtimeStore';
import { useUiStore } from '@/stores/uiStore';
import { ensureDatasetTable } from '@/features/logs/datasetRuntime';
import { getCachedTable } from '@/features/logs/tableCache';
import { formatNumber } from '@/utils/format';

const { Text } = Typography;

const TYPE_LABEL: Record<FieldType, string> = {
  number: '数值',
  string: '文本',
  date: '日期',
  enum: '枚举',
};

function uniqueFieldName(project: Project, node: CollectionNode, base: string): string {
  const cleaned = base.trim() || '字段';
  let candidate = cleaned;
  let index = 2;
  while (findFieldNameConflict(project, node.id, candidate)) {
    candidate = `${cleaned}${index}`;
    index += 1;
  }
  return candidate;
}

interface FieldRowProps {
  node: CollectionNode;
  field: FieldDef;
  dataset: DatasetMeta;
  readOnly: boolean;
  staticError?: string;
  runtimeError?: string;
  errorRows?: number;
}

function FieldRow({
  node,
  field,
  dataset,
  readOnly,
  staticError,
  runtimeError,
  errorRows = 0,
}: FieldRowProps) {
  const runCommand = useProjectStore((state) => state.runCommand);
  const [name, setName] = useState(field.name);
  const [formula, setFormula] = useState(field.formula ?? '');

  useEffect(() => {
    setName(field.name);
  }, [field.name]);
  useEffect(() => {
    setFormula(field.formula ?? '');
  }, [field.formula]);

  function commit(labelText: string, patch: Partial<FieldDef>) {
    try {
      runCommand(labelText, (draft) => updateCollectionField(draft, node.id, field.id, patch));
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
      return false;
    }
    return true;
  }

  function commitName() {
    const trimmed = name.trim();
    if (!trimmed || trimmed === field.name) {
      setName(field.name);
      return;
    }
    if (!commit('修改字段名', { name: trimmed, label: trimmed })) setName(field.name);
  }

  function commitFormula() {
    if (formula === (field.formula ?? '')) return;
    if (!commit('修改派生公式', { formula })) setFormula(field.formula ?? '');
  }

  function changeRole(role: 'input' | 'derived') {
    if (role === field.role) return;
    if (role === 'derived') {
      commit('修改字段角色', {
        role,
        type: 'number',
        formula: field.formula ?? '',
        sourceColumnId: undefined,
      });
      return;
    }
    const column =
      dataset.columns.find((candidate) => candidate.id === field.sourceColumnId) ??
      dataset.columns[0];
    commit('修改字段角色', {
      role,
      formula: undefined,
      type: column?.type ?? 'number',
      sourceColumnId: column?.id,
    });
  }

  const problem = staticError ?? (runtimeError ? `${runtimeError}${errorRows > 1 ? `（${errorRows} 行）` : ''}` : undefined);

  return (
    <div
      style={{
        padding: '8px 0',
        borderBottom: '1px solid var(--border-subtle, rgba(255,255,255,0.06))',
      }}
    >
      <Space.Compact style={{ width: '100%' }} size="small">
        <Input
          value={name}
          disabled={readOnly}
          onChange={(event) => setName(event.target.value)}
          onBlur={commitName}
          onPressEnter={commitName}
          style={{ width: 130, fontFamily: 'ui-monospace, Menlo, monospace' }}
          placeholder="字段名"
        />
        <Select
          size="small"
          value={field.role}
          disabled={readOnly}
          onChange={changeRole}
          style={{ width: 86 }}
          options={[
            { value: 'input', label: '输入列' },
            { value: 'derived', label: '派生列' },
          ]}
        />
        <Select
          size="small"
          value={field.type}
          disabled={readOnly || field.role === 'derived'}
          onChange={(type: FieldType) => commit('修改字段类型', { type })}
          style={{ width: 82 }}
          options={(Object.keys(TYPE_LABEL) as FieldType[]).map((type) => ({
            value: type,
            label: TYPE_LABEL[type],
          }))}
        />
        {field.role === 'input' ? (
          <Select
            size="small"
            value={field.sourceColumnId}
            disabled={readOnly}
            onChange={(sourceColumnId) => commit('修改字段映射', { sourceColumnId })}
            style={{ flex: 1, minWidth: 140 }}
            placeholder="映射数据列"
            options={dataset.columns.map((column) => ({
              value: column.id,
              label: `${column.name} · ${TYPE_LABEL[column.type]}`,
            }))}
          />
        ) : (
          <Input
            value={formula}
            disabled={readOnly}
            onChange={(event) => setFormula(event.target.value)}
            onBlur={commitFormula}
            onPressEnter={commitFormula}
            placeholder="派生公式，如 HP * ATK / (DEF + 100)"
            style={{ flex: 1, minWidth: 200, fontFamily: 'ui-monospace, Menlo, monospace' }}
          />
        )}
        <Tooltip title="删除字段">
          <Button
            size="small"
            type="text"
            danger
            disabled={readOnly}
            icon={<DeleteOutlined />}
            onClick={() => {
              try {
                runCommand('删除字段', (draft) => removeCollectionField(draft, node.id, field.id));
              } catch (error) {
                message.error(error instanceof Error ? error.message : String(error));
              }
            }}
          />
        </Tooltip>
      </Space.Compact>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 3 }}>
        <Tag
          bordered={false}
          color={field.role === 'derived' ? 'geekblue' : 'default'}
          style={{ fontSize: 10, lineHeight: '16px' }}
        >
          {field.role === 'derived' ? '派生' : '输入'}
        </Tag>
        {field.missing ? (
          <span style={{ fontSize: 11, color: 'var(--danger)' }}>映射列缺失或类型不兼容</span>
        ) : null}
        {problem ? <span style={{ fontSize: 11, color: 'var(--danger)' }}>{problem}</span> : null}
        {!problem && !field.missing && isNumericFieldType(field.type) ? (
          <span style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>可参与公式</span>
        ) : null}
      </div>
    </div>
  );
}

export default function CollectionEditor() {
  const project = useProjectStore((state) => state.project);
  const runCommand = useProjectStore((state) => state.runCommand);
  const readOnly = useProjectStore((state) => state.readOnly);
  const editingCollectionId = useUiStore((state) => state.editingCollectionId);
  const setEditingCollectionId = useUiStore((state) => state.setEditingCollectionId);

  const node =
    editingCollectionId && project.nodes[editingCollectionId]?.kind === 'collection'
      ? (project.nodes[editingCollectionId] as CollectionNode)
      : undefined;
  const dataset = node
    ? project.datasets.find((candidate) => candidate.id === node.datasetId)
    : undefined;
  const rebuildState = useRuntimeStore((state) =>
    node ? state.datasetRuntime[node.datasetId]?.rebuildState : undefined,
  );

  const [table, setTable] = useState<ColumnarTable | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    if (!node || !dataset || dataset.dataUnavailable) {
      setTable(null);
      setLoading(false);
      return;
    }
    const cached = getCachedTable(dataset.id, dataset.datasetHash);
    if (cached) {
      setTable(cached);
      setLoadError(undefined);
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(undefined);
    void ensureDatasetTable(dataset.id)
      .then((parsed) => {
        if (cancelled) return;
        setTable(parsed);
        setLoading(false);
        if (!parsed) setLoadError('数据尚未就绪，请稍候或到日志分析中检查数据源');
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setTable(null);
        setLoading(false);
        setLoadError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [node?.id, node?.datasetId, dataset?.id, dataset?.datasetHash, dataset?.dataUnavailable, rebuildState]);

  const analysis = useMemo(() => (node ? analyzeCollectionFields(node) : undefined), [node]);
  const result = useMemo(
    () =>
      node && table && !node.dataMissing
        ? evaluateCollectionColumns(project, node, sliceTable(table, 50))
        : undefined,
    [project, node, table],
  );

  if (!node) {
    return (
      <Modal
        open={Boolean(editingCollectionId)}
        title="数据表不存在"
        onCancel={() => setEditingCollectionId(null)}
        footer={null}
      >
        该数据表已被删除。
      </Modal>
    );
  }

  const collection = node;
  const bindingIssue = collectionBindingIssue(node, dataset);
  const derivedCount = node.fields.filter((field) => field.role === 'derived').length;
  const fieldErrorCount = analysis ? analysis.fieldErrors.size : 0;
  const previewRows = Array.from(
    { length: Math.min(50, result?.rowCount ?? 0) },
    (_, row) => ({ key: row, row }),
  );

  const previewColumns = node.fields.map((field) => ({
    key: field.id,
    title: (
      <span>
        {field.name}
        {field.role === 'derived' ? <span style={{ color: 'var(--text-muted)' }}> · 派生</span> : null}
      </span>
    ),
    width: 120,
    render: (_: unknown, row: { row: number }) => {
      const data = result?.fields[field.id];
      if (!data) return <span style={{ color: 'var(--text-muted)' }}>—</span>;
      if (data.valid[row.row] !== 1) return <span style={{ color: 'var(--text-muted)' }}>—</span>;
      if (!data.numeric) return <span>{data.textValues?.[row.row] ?? ''}</span>;
      return <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatNumber(data.values[row.row])}</span>;
    },
  }));

  function addInputField() {
    const mapped = new Set(
      collection.fields.filter((field) => field.role === 'input').map((field) => field.sourceColumnId),
    );
    const column = dataset?.columns.find((candidate) => !mapped.has(candidate.id));
    if (!column) {
      message.info('已没有未映射的数据列，可先调整现有字段映射');
      return;
    }
    const name = uniqueFieldName(project, collection, column.name);
    try {
      runCommand('新增输入字段', (draft) =>
        addCollectionField(draft, collection.id, {
          id: nanoid(),
          name,
          label: name,
          type: column.type,
          role: 'input',
          sourceColumnId: column.id,
        }),
      );
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  }

  function addDerivedField() {
    let index = 1;
    let name = `派生${index}`;
    while (findFieldNameConflict(project, collection.id, name)) {
      index += 1;
      name = `派生${index}`;
    }
    try {
      runCommand('新增派生字段', (draft) =>
        addCollectionField(draft, collection.id, {
          id: nanoid(),
          name,
          label: name,
          type: 'number',
          role: 'derived',
          formula: '',
        }),
      );
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  }

  const firstRuntimeError = result
    ? node.fields
        .map((field) => result.fields[field.id]?.firstError)
        .find((error) => Boolean(error))
    : undefined;

  return (
    <Modal
      open
      width={1020}
      title={
        <span>
          数据表 · {node.label}
          <Tag bordered={false} color="geekblue" style={{ marginLeft: 8 }}>
            {node.fields.length} 字段 · {derivedCount} 派生
          </Tag>
        </span>
      }
      onCancel={() => setEditingCollectionId(null)}
      footer={<Button onClick={() => setEditingCollectionId(null)}>关闭</Button>}
      destroyOnClose
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Text style={{ fontSize: 12, color: 'var(--text-muted)' }}>绑定数据集</Text>
        <Select
          size="small"
          value={node.datasetId}
          disabled={readOnly}
          style={{ minWidth: 240 }}
          onChange={(datasetId) => {
            try {
              runCommand('切换数据表数据集', (draft) =>
                setCollectionDataset(draft, node.id, datasetId),
              );
            } catch (error) {
              message.error(error instanceof Error ? error.message : String(error));
            }
          }}
          options={project.datasets.map((candidate) => ({
            value: candidate.id,
            label: `${candidate.name}${candidate.dataUnavailable ? '（不可用）' : ''} · ${candidate.rowCount} 行`,
            disabled: candidate.dataUnavailable,
          }))}
        />
        {dataset ? (
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {dataset.rowCount} 行 · {dataset.columns.length} 列
          </span>
        ) : null}
        <span style={{ flex: 1 }} />
        <Button
          size="small"
          icon={<PlusOutlined />}
          disabled={readOnly || !dataset}
          onClick={addInputField}
        >
          输入列
        </Button>
        <Button size="small" icon={<PlusOutlined />} disabled={readOnly} onClick={addDerivedField}>
          派生列
        </Button>
      </div>

      {bindingIssue ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginTop: 10 }}
          message={bindingIssue}
          description="保留字段定义，修复映射或替换数据源后会自动恢复；修复前不会批量求值。"
        />
      ) : null}
      {!bindingIssue && loadError ? (
        <Alert type="warning" showIcon style={{ marginTop: 10 }} message={loadError} />
      ) : null}
      {fieldErrorCount > 0 ? (
        <Alert
          type="error"
          showIcon
          style={{ marginTop: 10 }}
          message={`${fieldErrorCount} 个字段存在错误`}
          description="列循环、语法错误或非数值引用会阻止对应派生列求值。"
        />
      ) : null}
      {result && result.errorRows > 0 && firstRuntimeError ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginTop: 10 }}
          message={`${result.errorRows} 行求值失败`}
          description={`首个错误（第 ${firstRuntimeError.row + 1} 行）：${firstRuntimeError.message}`}
        />
      ) : null}

      <Divider style={{ margin: '12px 0 4px' }}>字段</Divider>
      {node.fields.length === 0 ? (
        <div style={{ padding: 12, fontSize: 12, color: 'var(--text-muted)' }}>
          还没有字段。添加输入列映射数据列，或添加派生列编写行公式。
        </div>
      ) : (
        node.fields.map((field) => (
          <FieldRow
            key={field.id}
            node={node}
            field={field}
            dataset={dataset ?? { ...emptyDataset, id: node.datasetId, name: node.datasetId }}
            readOnly={readOnly}
            staticError={analysis?.fieldErrors.get(field.id)}
            runtimeError={result?.fields[field.id]?.firstError?.message}
            errorRows={result?.fields[field.id]?.errorRows}
          />
        ))
      )}

      <Divider style={{ margin: '14px 0 8px' }}>预览（前 50 行）</Divider>
      <Table
        size="small"
        loading={loading}
        rowKey="key"
        pagination={false}
        dataSource={previewRows}
        columns={previewColumns}
        scroll={{ x: 'max-content', y: 280 }}
        locale={{
          emptyText: loading
            ? '正在加载数据'
            : bindingIssue ?? '没有可预览的数据（先添加字段或修复数据源）',
        }}
      />
    </Modal>
  );
}

/** Fallback meta so FieldRow can render before a dataset is bound. */
const emptyDataset: DatasetMeta = {
  id: '',
  name: '',
  format: 'csv',
  storage: 'blob',
  parserVersion: '1',
  rawBytesHash: '',
  parseParamsHash: '',
  contentHash: '',
  outputDigest: '',
  columns: [],
  rowCount: 0,
  datasetHash: '',
  createdAt: 0,
};
