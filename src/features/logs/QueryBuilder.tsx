import { nanoid } from 'nanoid';
import { Button, Input, InputNumber, Select, Space } from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import type { DatasetColumn, Filter, FilterOp, Metric, MetricOp } from '@/core/model/types';
import type { TimeBucketUnit } from '@/core/logs/aggregate';
import type { QueryConfig } from './queryTypes';
import styles from './QueryBuilder.module.css';

const FILTER_OPS: { value: FilterOp; label: string }[] = [
  { value: 'eq', label: '等于' },
  { value: 'neq', label: '不等于' },
  { value: 'gt', label: '大于' },
  { value: 'gte', label: '大于等于' },
  { value: 'lt', label: '小于' },
  { value: 'lte', label: '小于等于' },
  { value: 'in', label: '属于（逗号分隔）' },
  { value: 'contains', label: '包含' },
  { value: 'isNull', label: '为空' },
  { value: 'notNull', label: '不为空' },
];

const METRIC_OPS: { value: MetricOp; label: string; needsField: boolean }[] = [
  { value: 'count', label: '计数', needsField: false },
  { value: 'sum', label: '求和', needsField: true },
  { value: 'avg', label: '平均', needsField: true },
  { value: 'min', label: '最小', needsField: true },
  { value: 'max', label: '最大', needsField: true },
  { value: 'median', label: '中位数', needsField: true },
  { value: 'p90', label: 'P90', needsField: true },
  { value: 'p95', label: 'P95', needsField: true },
];

const METRIC_ALIAS_SUFFIX: Record<MetricOp, string> = {
  count: '行数',
  sum: '求和',
  avg: '平均',
  min: '最小',
  max: '最大',
  median: '中位数',
  p90: 'P90',
  p95: 'P95',
};

function autoAlias(op: MetricOp, column: DatasetColumn | undefined): string {
  if (op === 'count') return METRIC_ALIAS_SUFFIX.count;
  return `${column?.name ?? '指标'}${METRIC_ALIAS_SUFFIX[op]}`;
}

const BUCKET_OPS: { value: 'raw' | TimeBucketUnit; label: string }[] = [
  { value: 'raw', label: '原始值' },
  { value: 'minute', label: '按分钟' },
  { value: 'hour', label: '按小时' },
  { value: 'day', label: '按天' },
  { value: 'month', label: '按月' },
];

export interface QueryBuilderProps {
  columns: DatasetColumn[];
  config: QueryConfig;
  onChange: (config: QueryConfig) => void;
}

function columnOptions(columns: DatasetColumn[], numericOnly = false) {
  return columns
    .filter((column) => !numericOnly || column.type === 'number' || column.type === 'date')
    .map((column) => ({ value: column.id, label: `${column.name}（${column.type}）` }));
}

function defaultMetricValue(column: DatasetColumn | undefined): string | number | undefined {
  return column?.type === 'number' || column?.type === 'date' ? undefined : '';
}

export default function QueryBuilder({ columns, config, onChange }: QueryBuilderProps) {
  const update = (patch: Partial<QueryConfig>) => onChange({ ...config, ...patch });
  const hasDate = config.groupBy.some(
    (columnId) => columns.find((column) => column.id === columnId)?.type === 'date',
  );

  const updateFilter = (index: number, patch: Partial<Filter>) => {
    const filters = config.filters.map((filter, current) =>
      current === index ? { ...filter, ...patch } : filter,
    );
    update({ filters });
  };

  const updateMetric = (index: number, patch: Partial<Metric>) => {
    const metrics = config.metrics.map((metric, current) =>
      current === index ? { ...metric, ...patch } : metric,
    );
    update({ metrics });
  };

  const addFilter = () => {
    const column = columns[0];
    if (!column) return;
    update({
      filters: [
        ...config.filters,
        { fieldId: column.id, op: 'eq', value: defaultMetricValue(column) },
      ],
    });
  };

  const addMetric = () => {
    const numeric = columns.find((column) => column.type === 'number');
    const base = {
      id: nanoid(),
      op: 'sum' as MetricOp,
      fieldId: numeric?.id,
      alias: autoAlias('sum', numeric),
    };
    update({ metrics: [...config.metrics, base] });
  };

  return (
    <div className={styles.builder}>
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <span>筛选</span>
          <Button size="small" type="text" icon={<PlusOutlined />} onClick={addFilter}>
            添加
          </Button>
        </div>
        {config.filters.length === 0 && <div className={styles.hint}>未设置筛选，统计全部行。</div>}
        {config.filters.map((filter, index) => {
          const column = columns.find((candidate) => candidate.id === filter.fieldId);
          const noValue = filter.op === 'isNull' || filter.op === 'notNull';
          return (
            <div key={index} className={styles.row}>
              <Select
                size="small"
                value={filter.fieldId}
                style={{ width: 170 }}
                options={columnOptions(columns)}
                onChange={(value) => {
                  const nextColumn = columns.find((candidate) => candidate.id === value);
                  updateFilter(index, {
                    fieldId: value,
                    value: defaultMetricValue(nextColumn),
                  });
                }}
              />
              <Select
                size="small"
                value={filter.op}
                style={{ width: 150 }}
                options={FILTER_OPS}
                onChange={(value) => updateFilter(index, { op: value, value: undefined })}
              />
              {!noValue &&
                (filter.op === 'in' ? (
                  <Input
                    size="small"
                    style={{ width: 180 }}
                    placeholder="A,B,C"
                    value={Array.isArray(filter.value) ? filter.value.join(',') : ''}
                    onChange={(event) =>
                      updateFilter(index, {
                        value: event.target.value
                          .split(',')
                          .map((item) => item.trim())
                          .filter(Boolean)
                          .map((item) =>
                            column?.type === 'number' || column?.type === 'date'
                              ? Number(item)
                              : item,
                          ),
                      })
                    }
                  />
                ) : filter.op === 'gt' ||
                  filter.op === 'gte' ||
                  filter.op === 'lt' ||
                  filter.op === 'lte' ? (
                  <InputNumber
                    size="small"
                    style={{ width: 140 }}
                    value={typeof filter.value === 'number' ? filter.value : undefined}
                    onChange={(value) => updateFilter(index, { value: value ?? undefined })}
                  />
                ) : (
                  <Input
                    size="small"
                    style={{ width: 160 }}
                    value={filter.value === undefined ? '' : String(filter.value)}
                    onChange={(event) => {
                      const text = event.target.value;
                      const numeric = column?.type === 'number' || column?.type === 'date';
                      updateFilter(index, {
                        value: numeric && text.trim() !== '' ? Number(text) : text,
                      });
                    }}
                  />
                ))}
              <Button
                size="small"
                type="text"
                danger
                icon={<DeleteOutlined />}
                onClick={() =>
                  update({ filters: config.filters.filter((_, current) => current !== index) })
                }
              />
            </div>
          );
        })}
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <span>分组（最多 3 个）</span>
          {hasDate && (
            <Select
              size="small"
              value={config.timeBucketUnit}
              style={{ width: 110 }}
              options={BUCKET_OPS}
              onChange={(value) => update({ timeBucketUnit: value })}
            />
          )}
        </div>
        <Select
          size="small"
          mode="multiple"
          style={{ width: '100%' }}
          placeholder="不分组时输出单行汇总"
          value={config.groupBy}
          options={columnOptions(columns)}
          onChange={(value) => update({ groupBy: value.slice(0, 3) })}
        />
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <span>指标</span>
          <Space size={4}>
            <Select
              size="small"
              value={config.chartType}
              style={{ width: 88 }}
              options={[
                { value: 'line', label: '折线图' },
                { value: 'bar', label: '柱状图' },
              ]}
              onChange={(value) => update({ chartType: value })}
            />
            <Button size="small" type="text" icon={<PlusOutlined />} onClick={addMetric}>
              添加
            </Button>
          </Space>
        </div>
        {config.metrics.map((metric, index) => {
          const definition = METRIC_OPS.find((op) => op.value === metric.op);
          const currentColumn = columns.find((column) => column.id === metric.fieldId);
          const aliasIsAuto = metric.alias.trim() === '' || metric.alias === autoAlias(metric.op, currentColumn);
          return (
            <div key={metric.id} className={styles.row}>
              <Select
                size="small"
                value={metric.op}
                style={{ width: 110 }}
                options={METRIC_OPS.map((op) => ({ value: op.value, label: op.label }))}
                onChange={(value) => {
                  const nextOp = value as MetricOp;
                  const needsField = METRIC_OPS.find((candidate) => candidate.value === value)?.needsField ?? false;
                  const numeric = columns.find((column) => column.type === 'number');
                  const nextFieldId = needsField ? (metric.fieldId ?? numeric?.id) : undefined;
                  const nextColumn = columns.find((column) => column.id === nextFieldId);
                  updateMetric(index, {
                    op: nextOp,
                    fieldId: nextFieldId,
                    alias: aliasIsAuto ? autoAlias(nextOp, nextColumn) : metric.alias,
                  });
                }}
              />
              <Select
                size="small"
                style={{ width: 170 }}
                value={metric.fieldId}
                placeholder={definition?.needsField ? '选择数值列' : '不需要字段'}
                disabled={!definition?.needsField}
                options={columnOptions(columns, true)}
                onChange={(value) => {
                  const nextColumn = columns.find((column) => column.id === value);
                  updateMetric(index, {
                    fieldId: value,
                    alias: aliasIsAuto ? autoAlias(metric.op, nextColumn) : metric.alias,
                  });
                }}
              />
              <Input
                size="small"
                style={{ width: 150 }}
                value={metric.alias}
                onChange={(event) => updateMetric(index, { alias: event.target.value })}
              />
              <Button
                size="small"
                type="text"
                danger
                icon={<DeleteOutlined />}
                disabled={config.metrics.length <= 1}
                onClick={() =>
                  update({ metrics: config.metrics.filter((_, current) => current !== index) })
                }
              />
            </div>
          );
        })}
      </section>
    </div>
  );
}
