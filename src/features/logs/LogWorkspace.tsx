import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Empty,
  Input,
  Modal,
  Popconfirm,
  Segmented,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Upload,
  message,
} from 'antd';
import {
  DeleteOutlined,
  InboxOutlined,
  ReloadOutlined,
  SettingOutlined,
  SwapOutlined,
} from '@ant-design/icons';
import { nanoid } from 'nanoid';
import type { AnalysisView, DatasetMeta, FieldType } from '@/core/model/types';
import type { ColumnarTable } from '@/core/logs/parse';
import { importDataset, type ImportDatasetResult } from '@/core/logs/importDataset';
import type { SupportedEncoding } from '@/core/logs/decode';
import { aggregateTable, type AggregateResult } from '@/core/logs/aggregate';
import { computeSchemaHash } from '@/core/logs/datasetHash';
import { checkDatasetRunnable } from '@/core/logs/datasetRunnable';
import {
  addAnalysisView,
  addDataset,
  removeAnalysisView,
  removeDataset,
  replaceDatasetMeta,
} from '@/core/model/commands';
import { validateAnalysisView, viewReferencedColumnIds } from '@/core/model/analysisViews';
import { makeBlobKey, putBlob } from '@/platform/storage/idbBlob';
import { clearBlobGc, enqueueBlobGc } from '@/platform/storage/blobGc';
import { useProjectStore } from '@/stores/projectStore';
import { useRuntimeStore } from '@/stores/runtimeStore';
import {
  ensureDatasetTable,
  invalidateDatasetRebuild,
  parseSettingsKey,
} from './datasetRuntime';
import { replaceDatasetSource } from './replaceDataset';
import { cacheTable, dropTableCache } from './tableCache';
import { parseInWorker, WORKER_PARSE_THRESHOLD } from './logImportClient';
import QueryBuilder from './QueryBuilder';
import ChartPanel from './ChartPanel';
import { createDefaultQuery, type QueryConfig } from './queryTypes';
import styles from './LogWorkspace.module.css';

const MAX_BYTES = 50 * 1024 * 1024;
const PREVIEW_ROWS = 100;

interface PendingImport {
  fileName: string;
  bytes: Uint8Array;
  result: ImportDatasetResult;
}

function formatCell(value: string | number | null, type: FieldType) {
  if (value === null || value === undefined) {
    return <span className={styles.nullCell}>—</span>;
  }
  if (type === 'date' && typeof value === 'number') {
    return new Date(value).toLocaleString('zh-CN', { hour12: false });
  }
  if (typeof value === 'number') {
    return Number.isInteger(value) ? String(value) : String(Number(value.toPrecision(6)));
  }
  return value;
}

function tableToRows(table: ColumnarTable, limit: number): Record<string, unknown>[] {
  const count = Math.min(limit, table.rowCount);
  const rows: Record<string, unknown>[] = [];
  for (let rowIndex = 0; rowIndex < count; rowIndex += 1) {
    const row: Record<string, unknown> = { __row: rowIndex };
    for (let columnIndex = 0; columnIndex < table.columns.length; columnIndex += 1) {
      const column = table.columns[columnIndex]!;
      const vector = table.vectors[columnIndex]!;
      const valid = vector.valid[rowIndex] === 1;
      row[column.id] = valid
        ? vector.type === 'number' || vector.type === 'date'
          ? vector.values[rowIndex]!
          : (vector.values[rowIndex] ?? null)
        : null;
    }
    rows.push(row);
  }
  return rows;
}

function previewColumns(table: ColumnarTable) {
  return table.columns.map((column, index) => {
    const vector = table.vectors[index]!;
    return {
      key: column.id,
      dataIndex: column.id,
      width: 150,
      title: (
        <div className={styles.columnTitle}>
          <span>{column.name}</span>
          <div className={styles.columnMeta}>
            <Tag bordered={false}>{column.type}</Tag>
            {(vector.nullCount > 0 || vector.badCount > 0) && (
              <span className={styles.counts}>
                空 {vector.nullCount} / 坏 {vector.badCount}
              </span>
            )}
          </div>
        </div>
      ),
      render: (value: string | number | null) => formatCell(value, column.type),
    };
  });
}

function uniqueDatasetName(project: { datasets: DatasetMeta[] }, base: string): string {
  const names = new Set(project.datasets.map((dataset) => dataset.name.toLowerCase()));
  if (!names.has(base.toLowerCase())) return base;
  let suffix = 2;
  while (names.has(`${base} (${suffix})`.toLowerCase())) suffix += 1;
  return `${base} (${suffix})`;
}

export default function LogWorkspace() {
  const project = useProjectStore((state) => state.project);
  const readOnly = useProjectStore((state) => state.readOnly);
  const runCommand = useProjectStore((state) => state.runCommand);
  const datasetRuntime = useRuntimeStore((state) => state.datasetRuntime);
  const setDatasetRuntime = useRuntimeStore((state) => state.setDatasetRuntime);
  const removeDatasetRuntime = useRuntimeStore((state) => state.removeDatasetRuntime);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [table, setTable] = useState<ColumnarTable | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [importOpen, setImportOpen] = useState(false);
  const [fileName, setFileName] = useState('');
  const [fileBytes, setFileBytes] = useState<Uint8Array | null>(null);
  const [encoding, setEncoding] = useState<SupportedEncoding>('auto');
  const [delimiter, setDelimiter] = useState('auto');
  const [hasHeader, setHasHeader] = useState(true);
  const [typeOverrides, setTypeOverrides] = useState<Record<number, FieldType>>({});
  const [pending, setPending] = useState<PendingImport | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const loadToken = useRef(0);
  const parseToken = useRef(0);

  const [mode, setMode] = useState<'preview' | 'analysis'>('preview');
  const [query, setQuery] = useState<QueryConfig>(createDefaultQuery);
  const [viewName, setViewName] = useState('');
  const skipQueryReset = useRef(false);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editEncoding, setEditEncoding] = useState<SupportedEncoding>('auto');
  const [editDelimiter, setEditDelimiter] = useState('auto');
  const [editHasHeader, setEditHasHeader] = useState(true);
  const [editTimeZone, setEditTimeZone] = useState('');
  const [editDateFormat, setEditDateFormat] = useState('auto');

  const replaceState = useRuntimeStore((state) => state.replaceState);
  const [replacing, setReplacing] = useState(false);
  const replaceInput = useRef<HTMLInputElement | null>(null);
  /** Dataset whose current table was produced by the active selectedSource. */
  const loadedFor = useRef<string | null>(null);

  useEffect(() => {
    if (skipQueryReset.current) {
      skipQueryReset.current = false;
      return;
    }
    setQuery(createDefaultQuery());
    setMode('preview');
  }, [selectedId]);

  const datasets = project.datasets;
  const selectedMeta = datasets.find((dataset) => dataset.id === selectedId) ?? null;

  useEffect(() => {
    if (selectedId && !datasets.some((dataset) => dataset.id === selectedId)) {
      setSelectedId(null);
      setTable(null);
    }
    if (!selectedId && datasets.length > 0) {
      setSelectedId(datasets[0]!.id);
    }
  }, [datasets, selectedId]);

  // Load the stored parse settings into the edit form when switching datasets.
  useEffect(() => {
    const meta = project.datasets.find((dataset) => dataset.id === selectedId);
    if (!meta) return;
    setEditEncoding((meta.encoding as SupportedEncoding | undefined) ?? 'utf-8');
    setEditDelimiter(meta.delimiter ?? ',');
    setEditHasHeader(meta.hasHeader ?? true);
    setEditTimeZone(meta.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
    setEditDateFormat(meta.dateFormat ?? 'auto');
  }, [selectedId]);

  /**
   * Load (or rebuild) the selected dataset's table. Every trigger — selection,
   * parse settings change, undo of a replacement — goes through here so the
   * load token, runtime flags and error surface stay consistent.
   */
  const startLoad = useCallback(
    (datasetId: string, announce: boolean) => {
      const token = (loadToken.current += 1);
      setLoading(true);
      setLoadError(null);
      setTable(null);
      void ensureDatasetTable(datasetId)
        .then((result) => {
          if (loadToken.current !== token) return;
          if (!result) {
            const runtime = useRuntimeStore.getState().datasetRuntime[datasetId];
            setLoadError(runtime?.error ?? '数据源不可用，无法读取内容');
            return;
          }
          setTable(result);
          loadedFor.current = datasetId;
          if (announce) {
            message.success(
              `已按当前解析设置重建：${result.rowCount} 行 · ${result.columns.length} 列`,
            );
          }
        })
        .catch((error) => {
          if (loadToken.current !== token) return;
          setLoadError(error instanceof Error ? error.message : String(error));
        })
        .finally(() => {
          if (loadToken.current === token) setLoading(false);
        });
    },
    [],
  );

  useEffect(() => {
    if (!selectedId) {
      setTable(null);
      return undefined;
    }
    startLoad(selectedId, false);
    return () => {
      loadToken.current += 1;
    };
  }, [selectedId, startLoad]);

  // A dataset's parse settings can change without the selection changing:
  // 解析设置 command, or undo/redo of it. The cached table then belongs to the
  // old settings, so drop it and rebuild from the original bytes.
  const settingsKey = useMemo(
    () => (selectedMeta ? parseSettingsKey(selectedMeta) : null),
    [selectedMeta],
  );
  const loadedSettings = useRef<{ datasetId: string; key: string } | null>(null);
  useEffect(() => {
    if (!selectedId || !settingsKey) {
      loadedSettings.current = null;
      return;
    }
    const previous = loadedSettings.current;
    loadedSettings.current = { datasetId: selectedId, key: settingsKey };
    if (!previous || previous.datasetId !== selectedId || previous.key === settingsKey) {
      return;
    }
    invalidateDatasetRebuild(selectedId);
    dropTableCache(selectedId);
    setDatasetRuntime(selectedId, {
      blobPresent: true,
      rowsLoaded: false,
      loadedDatasetHash: undefined,
      rebuildState: 'pending',
      error: undefined,
      integrityError: undefined,
      expectOutputChange: true,
      driftWarning: undefined,
    });
    startLoad(selectedId, true);
  }, [selectedId, settingsKey, setDatasetRuntime, startLoad]);

  // The document hash can change without a settings change: undoing a dataset
  // replacement restores the old blobKey/datasetHash. Once the loaded table no
  // longer matches the document, rebuild from the (restored) source.
  useEffect(() => {
    if (!selectedId || !selectedMeta || loading) return;
    if (replaceState?.datasetId === selectedId) return;
    if (loadedFor.current !== selectedId) return;
    const runtime = datasetRuntime[selectedId];
    if (!runtime || runtime.rebuildState !== 'idle') return;
    if (runtime.loadedDatasetHash === selectedMeta.datasetHash) return;
    invalidateDatasetRebuild(selectedId);
    dropTableCache(selectedId);
    startLoad(selectedId, false);
  }, [
    selectedId,
    selectedMeta,
    datasetRuntime,
    loading,
    replaceState?.datasetId,
    startLoad,
  ]);

  const parsePending = useCallback(async () => {
    if (!fileBytes) return;
    const token = (parseToken.current += 1);
    setParsing(true);
    try {
      const options = {
        datasetId: nanoid(),
        name: fileName.replace(/\.[^.]+$/, '') || fileName,
        fileName,
        bytes: fileBytes,
        encoding,
        delimiter: delimiter === 'auto' ? undefined : delimiter,
        hasHeader,
        types: typeOverrides,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      };
      const result =
        typeof Worker !== 'undefined' && fileBytes.byteLength > WORKER_PARSE_THRESHOLD
          ? await parseInWorker(options)
          : importDataset(options);
      if (parseToken.current !== token) return;
      setPending({ fileName, bytes: fileBytes, result });
      setParseError(null);
    } catch (error) {
      if (parseToken.current !== token) return;
      setPending(null);
      setParseError(error instanceof Error ? error.message : String(error));
    } finally {
      if (parseToken.current === token) setParsing(false);
    }
  }, [delimiter, encoding, fileBytes, fileName, hasHeader, typeOverrides]);

  const typeSignature = useMemo(
    () =>
      Object.keys(typeOverrides)
        .sort()
        .map((key) => `${key}:${typeOverrides[Number(key)]}`)
        .join(','),
    [typeOverrides],
  );

  useEffect(() => {
    if (!pending) return;
    void parsePending();
    // Only explicit type changes should trigger a re-parse; other dependencies
    // clear `pending` on their own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeSignature]);

  const handleFileChosen = async (actual: File) => {
    if (actual.size > MAX_BYTES) {
      message.error('文件超过 50MB 上限');
      return;
    }
    const buffer = await actual.arrayBuffer();
    parseToken.current += 1;
    setParsing(false);
    setFileName(actual.name);
    setFileBytes(new Uint8Array(buffer));
    setTypeOverrides({});
    setPending(null);
    setParseError(null);
    setImportOpen(true);
  };

  const savePending = async () => {
    if (!pending || readOnly) return;
    setSaving(true);
    const projectId = project.id;
    const blobKey = makeBlobKey(projectId);
    try {
      await putBlob(projectId, blobKey, pending.bytes, 'text/plain', pending.result.meta.id);
      const baseName = fileName.replace(/\.[^.]+$/, '') || fileName;
      const meta: DatasetMeta = {
        ...pending.result.meta,
        name: uniqueDatasetName(project, baseName),
        storage: 'blob',
        blobKey,
      };
      runCommand(
        '导入数据集',
        (draft) => {
          addDataset(draft, meta);
        },
        { datasetIds: [meta.id], blobKeys: [blobKey] },
      );
      // The document now references the blob; the registration only existed to
      // cover a crash between the write and this commit.
      void clearBlobGc(blobKey).catch(() => undefined);
      cacheTable(meta.id, meta.datasetHash, pending.result.table);
      setDatasetRuntime(meta.id, {
        blobPresent: true,
        rowsLoaded: true,
        loadedDatasetHash: meta.datasetHash,
        rebuildState: 'idle',
      });
      setSelectedId(meta.id);
      setImportOpen(false);
      setPending(null);
      setFileBytes(null);
      setFileName('');
      message.success(`已导入 ${pending.result.table.rowCount} 行`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  const rebuildSelected = async () => {
    if (!selectedId) return;
    if (useRuntimeStore.getState().replaceState?.datasetId === selectedId) {
      message.info('正在替换数据源，请等待完成');
      return;
    }
    dropTableCache(selectedId);
    setLoading(true);
    const result = await ensureDatasetTable(selectedId);
    setTable(result);
    setLoading(false);
    if (result) message.success('已重建数据集');
  };

  const applyParseSettings = () => {
    if (!selectedMeta || readOnly) return;
    if (useRuntimeStore.getState().replaceState?.datasetId === selectedMeta.id) {
      message.info('正在替换数据源，请等待完成');
      return;
    }
    const timeZone = editTimeZone.trim();
    if (timeZone) {
      try {
        new Intl.DateTimeFormat('en-US', { timeZone });
      } catch {
        message.error('时区无效，请填写 IANA 时区，例如 Asia/Shanghai');
        return;
      }
    }
    const nextMeta: DatasetMeta = {
      ...selectedMeta,
      encoding: editEncoding,
      delimiter: editDelimiter,
      hasHeader: editHasHeader,
      timeZone: timeZone || undefined,
      dateFormat: editDateFormat === 'auto' ? undefined : editDateFormat,
    };
    const unchanged =
      nextMeta.encoding === selectedMeta.encoding &&
      nextMeta.delimiter === selectedMeta.delimiter &&
      (nextMeta.hasHeader ?? true) === (selectedMeta.hasHeader ?? true) &&
      (nextMeta.timeZone ?? '') === (selectedMeta.timeZone ?? '') &&
      (nextMeta.dateFormat ?? '') === (selectedMeta.dateFormat ?? '');
    setSettingsOpen(false);
    if (unchanged) return;

    // The settings effect below sees the changed fields and rebuilds. Keeping
    // the rebuild trigger in one place means undo/redo of this command is
    // handled too.
    try {
      runCommand('修改解析设置', (draft) => {
        replaceDatasetMeta(draft, nextMeta);
      });
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  };

  const deleteSelectedDataset = () => {
    if (!selectedMeta || readOnly) return;
    if (useRuntimeStore.getState().replaceState?.datasetId === selectedMeta.id) {
      message.info('正在替换数据源，请等待完成');
      return;
    }
    const dataset = selectedMeta;
    const blobKey = dataset.blobKey;
    try {
      runCommand(
        '删除数据集',
        (draft) => {
          removeDataset(draft, dataset.id);
        },
        { datasetIds: [dataset.id], blobKeys: blobKey ? [blobKey] : [] },
      );
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
      return;
    }
    dropTableCache(dataset.id);
    removeDatasetRuntime(dataset.id);
    setTable(null);
    setLoadError(null);
    // The blob stays for the 24h undo window; GC deletes it only if the
    // document still does not reference it after that.
    if (blobKey) {
      void enqueueBlobGc(project.id, dataset.id, blobKey).catch(() => undefined);
    }
    const brokenViews = project.views.filter(
      (view) => view.datasetId === dataset.id && view.status === 'active',
    ).length;
    message.success(
      `已删除数据集「${dataset.name}」${brokenViews > 0 ? `，${brokenViews} 个分析视图已失效` : ''}`,
    );
  };

  const handleReplaceFile = async (file: File) => {
    if (!selectedMeta || readOnly) return;
    if (file.size > MAX_BYTES) {
      message.error('文件超过 50MB 上限');
      return;
    }
    const datasetId = selectedMeta.id;
    setReplacing(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const outcome = await replaceDatasetSource(datasetId, file.name, bytes);
      if (!outcome.ok) {
        if (outcome.cancelled) message.info(outcome.error);
        else message.error(outcome.error);
        return;
      }
      // The replacement already produced the new table; stop any in-flight
      // selection/settings load from overwriting it.
      loadToken.current += 1;
      loadedFor.current = datasetId;
      loadedSettings.current = {
        datasetId,
        key: parseSettingsKey(outcome.meta),
      };
      setTable(outcome.table);
      setLoadError(null);
      setLoading(false);
      message.success(
        `已替换数据源：${outcome.table.rowCount} 行 · ${outcome.table.columns.length} 列`,
      );
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setReplacing(false);
    }
  };

  const aggregation = useMemo<{ result?: AggregateResult; error?: string }>(() => {
    if (!table || !selectedMeta || mode !== 'analysis') return {};
    const bucketField =
      query.timeBucketUnit === 'raw'
        ? undefined
        : selectedMeta.columns.find(
            (column) => column.type === 'date' && query.groupBy.includes(column.id),
          );
    try {
      return {
        result: aggregateTable(table, {
          filters: query.filters,
          groupBy: query.groupBy,
          metrics: query.metrics,
          timeBucket:
            bucketField && query.timeBucketUnit !== 'raw'
              ? { fieldId: bucketField.id, unit: query.timeBucketUnit }
              : undefined,
          timeZone: selectedMeta.timeZone,
        }),
      };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }, [mode, query, selectedMeta, table]);

  const saveAnalysisView = () => {
    if (!selectedMeta) return;
    const bucketField = selectedMeta.columns.find(
      (column) => column.type === 'date' && query.groupBy.includes(column.id),
    );
    const view: AnalysisView = {
      id: nanoid(),
      name: viewName.trim() || `${selectedMeta.name} 分析`,
      datasetId: selectedMeta.id,
      filters: query.filters,
      groupBy: query.groupBy,
      metrics: query.metrics,
      chart: {
        type: query.chartType,
        xFieldId: query.groupBy[0],
        yMetricIds: query.metrics.map((metric) => metric.id),
      },
      timeBucket:
        bucketField && query.timeBucketUnit !== 'raw'
          ? { fieldId: bucketField.id, unit: query.timeBucketUnit }
          : undefined,
      schemaHash: '',
      status: 'active',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    view.schemaHash = computeSchemaHash(
      selectedMeta.columns,
      viewReferencedColumnIds(view),
    );
    try {
      runCommand('保存分析视图', (draft) => {
        addAnalysisView(draft, view);
      });
      setViewName('');
      message.success(`已保存视图「${view.name}」`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  };

  const applyAnalysisView = (view: AnalysisView) => {
    const viewDataset = datasets.find((dataset) => dataset.id === view.datasetId);
    if (!viewDataset) {
      message.error('视图引用的数据集不存在');
      return;
    }
    const validation = validateAnalysisView(project, view);
    if (view.status === 'broken' || validation.broken) {
      message.error(
        `视图「${view.name}」已失效：${view.brokenReason ?? validation.reason ?? '引用列已变化'}`,
      );
      return;
    }
    const verdict = checkDatasetRunnable(viewDataset, datasetRuntime[view.datasetId]);
    if (!verdict.runnable) {
      // Rebuild states resolve on their own once the dataset is selected, but a
      // missing source or a parse error will not: refuse to pretend the view ran.
      if (viewDataset.dataUnavailable || datasetRuntime[view.datasetId]?.rebuildState === 'error') {
        message.error(`视图「${view.name}」暂不可运行：${verdict.reason}`);
        return;
      }
      message.info(`视图「${view.name}」将等数据集重建完成后运行`);
    }
    skipQueryReset.current = true;
    setSelectedId(view.datasetId);
    setQuery({
      filters: view.filters,
      groupBy: view.groupBy,
      metrics: view.metrics,
      timeBucketUnit: view.timeBucket?.unit ?? 'raw',
      chartType: view.chart?.type === 'bar' ? 'bar' : 'line',
    });
    setMode('analysis');
  };

  const previewData = useMemo(
    () => (pending ? tableToRows(pending.result.table, PREVIEW_ROWS) : []),
    [pending],
  );
  const previewCols = useMemo(
    () => (pending ? previewColumns(pending.result.table) : []),
    [pending],
  );
  const dataRows = useMemo(() => (table ? tableToRows(table, PREVIEW_ROWS) : []), [table]);
  const dataCols = useMemo(() => (table ? previewColumns(table) : []), [table]);

  const aggregateRows = useMemo(() => {
    if (!aggregation.result) return [];
    return aggregation.result.rows.map((row, rowIndex) => {
      const record: Record<string, unknown> = { __row: rowIndex };
      row.forEach((cell, index) => {
        record[String(index)] = cell;
      });
      return record;
    });
  }, [aggregation.result]);

  const aggregateCols = useMemo(() => {
    if (!aggregation.result) return [];
    return aggregation.result.columns.map((column, index) => ({
      key: column.id,
      dataIndex: String(index),
      title: column.name,
      width: 150,
      render: (value: string | number | null) => formatCell(value, column.type),
    }));
  }, [aggregation.result]);

  const selectedRuntime = selectedId ? datasetRuntime[selectedId] : undefined;
  const totalNull = table
    ? table.vectors.reduce((total, vector) => total + vector.nullCount, 0)
    : 0;
  const totalBad = table
    ? table.vectors.reduce((total, vector) => total + vector.badCount, 0)
    : 0;

  return (
    <div className={styles.workspace}>
      <aside className={styles.sidebar}>
        <div className={styles.sidebarHeader}>
          <span>数据集</span>
          <Button size="small" type="primary" onClick={() => setImportOpen(true)} disabled={readOnly}>
            导入
          </Button>
        </div>
        <div className={styles.datasetList}>
          {datasets.length === 0 && (
            <div className={styles.emptyHint}>还没有日志数据，点击“导入”选择 CSV 或 JSONL。</div>
          )}
          {datasets.map((dataset) => {
            const runtime = datasetRuntime[dataset.id];
            const status =
              dataset.dataUnavailable || runtime?.rebuildState === 'error' || runtime?.integrityError
                ? 'error'
                : runtime?.rebuildState === 'rebuilding' || runtime?.rebuildState === 'pending'
                  ? 'loading'
                  : 'ok';
            const statusClass =
              status === 'error' ? styles.dotError : status === 'loading' ? styles.dotLoading : styles.dotOk;
            return (
              <button
                key={dataset.id}
                type="button"
                className={`${styles.datasetItem} ${dataset.id === selectedId ? styles.datasetItemActive : ''}`}
                onClick={() => setSelectedId(dataset.id)}
              >
                <div className={styles.datasetName}>{dataset.name}</div>
                <div className={styles.datasetMeta}>
                  <span className={`${styles.statusDot} ${statusClass}`} />
                  <span>
                    {dataset.rowCount} 行 · {dataset.columns.length} 列
                  </span>
                  <Tag bordered={false}>{dataset.format.toUpperCase()}</Tag>
                </div>
              </button>
            );
          })}
        </div>
        <div className={styles.sidebarHeader}>
          <span>分析视图</span>
        </div>
        <div className={styles.viewList}>
          {project.views.length === 0 && (
            <div className={styles.emptyHint}>在“聚合分析”中保存查询后，会出现在这里。</div>
          )}
          {project.views.map((view) => {
            const dataset = datasets.find((candidate) => candidate.id === view.datasetId);
            return (
              <div key={view.id} className={styles.viewItem} onClick={() => applyAnalysisView(view)}>
                <div className={styles.viewBody}>
                  <div className={styles.datasetName}>{view.name}</div>
                  <div className={styles.datasetMeta}>
                    <span>{dataset?.name ?? '数据集缺失'}</span>
                    {view.status === 'broken' && (
                      <Tag color="error" title={view.brokenReason}>
                        失效
                      </Tag>
                    )}
                    {view.status !== 'broken' &&
                      dataset &&
                      !checkDatasetRunnable(dataset, datasetRuntime[dataset.id]).runnable && (
                        <Tag
                          color="warning"
                          title={checkDatasetRunnable(dataset, datasetRuntime[dataset.id]).reason}
                        >
                          待就绪
                        </Tag>
                      )}
                  </div>
                </div>
                <Button
                  size="small"
                  type="text"
                  danger
                  disabled={readOnly}
                  icon={<DeleteOutlined />}
                  onClick={(event) => {
                    event.stopPropagation();
                    runCommand('删除分析视图', (draft) => {
                      removeAnalysisView(draft, view.id);
                    });
                  }}
                />
              </div>
            );
          })}
        </div>
      </aside>

      <main className={styles.main}>
        {!selectedMeta && (
          <div className={styles.placeholder}>
            <Empty description="导入日志后在这里预览与聚合" />
            <Button type="primary" onClick={() => setImportOpen(true)} disabled={readOnly}>
              导入 CSV / JSONL
            </Button>
          </div>
        )}

        {selectedMeta && (
          <>
            <div className={styles.header}>
              <div>
                <div className={styles.title}>{selectedMeta.name}</div>
                <div className={styles.subtitle}>
                  {selectedMeta.rowCount} 行 · {selectedMeta.columns.length} 列 ·{' '}
                  {selectedMeta.encoding ?? '未知编码'}
                  {selectedMeta.delimiter
                    ? ` · 分隔符「${selectedMeta.delimiter === '\t' ? '\\t' : selectedMeta.delimiter}」`
                    : ''}
                  {totalNull > 0 || totalBad > 0 ? ` · 空 ${totalNull} / 坏 ${totalBad}` : ''}
                </div>
              </div>
              <Space>
                <Segmented
                  size="small"
                  value={mode}
                  onChange={(value) => setMode(value as 'preview' | 'analysis')}
                  options={[
                    { value: 'preview', label: '数据预览' },
                    { value: 'analysis', label: '聚合分析' },
                  ]}
                />
                <Button
                  size="small"
                  icon={<SwapOutlined />}
                  onClick={() => replaceInput.current?.click()}
                  loading={replacing}
                  disabled={readOnly || replaceState?.datasetId === selectedMeta.id}
                >
                  替换数据源
                </Button>
                <input
                  ref={replaceInput}
                  type="file"
                  data-role="replace-source"
                  accept=".csv,.jsonl,text/csv,application/jsonl"
                  style={{ display: 'none' }}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = '';
                    if (file) void handleReplaceFile(file);
                  }}
                />
                <Button
                  size="small"
                  icon={<SettingOutlined />}
                  onClick={() => setSettingsOpen(true)}
                  disabled={readOnly || replaceState?.datasetId === selectedMeta.id}
                >
                  解析设置
                </Button>
                <Button
                  size="small"
                  icon={<ReloadOutlined />}
                  onClick={() => void rebuildSelected()}
                  loading={loading}
                  disabled={readOnly || replaceState?.datasetId === selectedMeta.id}
                >
                  重建
                </Button>
                <Popconfirm
                  title={`删除数据集「${selectedMeta.name}」`}
                  description={
                    project.views.filter((view) => view.datasetId === selectedMeta.id).length > 0
                      ? '引用它的分析视图将失效。原始文件会在宽限期后回收，期间可撤销。'
                      : '原始文件会在宽限期后回收，期间可撤销。'
                  }
                  okText="删除"
                  okButtonProps={{ danger: true }}
                  onConfirm={deleteSelectedDataset}
                >
                  <Button
                    size="small"
                    danger
                    icon={<DeleteOutlined />}
                    disabled={readOnly || replaceState?.datasetId === selectedMeta.id}
                  >
                    删除
                  </Button>
                </Popconfirm>
              </Space>
            </div>

            {selectedRuntime?.integrityError && (
              <Alert type="error" showIcon message={selectedRuntime.integrityError} />
            )}
            {selectedRuntime?.error && (
              <Alert type="error" showIcon message={selectedRuntime.error} />
            )}
            {loadError && <Alert type="error" showIcon message={loadError} />}
            {selectedRuntime?.driftWarning && (
              <Alert type="warning" showIcon message={selectedRuntime.driftWarning} />
            )}
            {replaceState?.datasetId === selectedMeta.id && (
              <Alert type="info" showIcon message="正在替换数据源，完成后会自动切换到新数据" />
            )}
            {loading && !replacing && <div className={styles.loadingHint}>正在读取列式数据…</div>}

            {table && !loading && mode === 'preview' && (
              <>
                <div className={styles.tableHint}>
                  预览前 {Math.min(table.rowCount, PREVIEW_ROWS)} 行（共 {table.rowCount} 行）
                  {table.raggedRows > 0 ? `，${table.raggedRows} 行列数不齐` : ''}
                </div>
                <Table
                  className={styles.table}
                  size="small"
                  bordered
                  rowKey="__row"
                  columns={dataCols}
                  dataSource={dataRows}
                  pagination={{ pageSize: 20, size: 'small', showSizeChanger: false }}
                  scroll={{ x: 'max-content' }}
                />
              </>
            )}

            {table && !loading && mode === 'analysis' && (
              <div className={styles.analysis}>
                <QueryBuilder columns={selectedMeta.columns} config={query} onChange={setQuery} />
                {aggregation.error && (
                  <Alert type="error" showIcon message={aggregation.error} />
                )}
                {aggregation.result && (
                  <>
                    <ChartPanel
                      result={aggregation.result}
                      chartType={query.chartType}
                      timeUnit={query.timeBucketUnit === 'raw' ? undefined : query.timeBucketUnit}
                    />
                    <div className={styles.saveBar}>
                      <Input
                        size="small"
                        style={{ width: 220 }}
                        placeholder="视图名称（可留空）"
                        value={viewName}
                        onChange={(event) => setViewName(event.target.value)}
                        onPressEnter={saveAnalysisView}
                      />
                      <Button type="primary" size="small" onClick={saveAnalysisView} disabled={readOnly}>
                        保存视图
                      </Button>
                      <span className={styles.saveHint}>
                        筛选后 {aggregation.result.filteredRows} 行 · 共{' '}
                        {aggregation.result.rows.length} 组
                        {aggregation.result.truncated ? '（已截断）' : ''}
                      </span>
                    </div>
                    <Table
                      className={styles.table}
                      size="small"
                      bordered
                      rowKey="__row"
                      columns={aggregateCols}
                      dataSource={aggregateRows}
                      pagination={{ pageSize: 20, size: 'small', showSizeChanger: false }}
                      scroll={{ x: 'max-content' }}
                    />
                  </>
                )}
              </div>
            )}
          </>
        )}
      </main>

      <Modal
        title="导入日志数据"
        open={importOpen}
        width={960}
        onCancel={() => setImportOpen(false)}
        destroyOnClose
        footer={
          <Space>
            <Button onClick={() => setImportOpen(false)}>取消</Button>
            <Button onClick={() => void parsePending()} loading={parsing} disabled={!fileBytes || parsing}>
              解析预览
            </Button>
            <Button
              type="primary"
              loading={saving}
              disabled={!pending || parsing}
              onClick={() => void savePending()}
            >
              保存到项目
            </Button>
          </Space>
        }
      >
        <div className={styles.importBody}>
          <Upload.Dragger
            accept=".csv,.jsonl,.txt,.log"
            maxCount={1}
            showUploadList={false}
            beforeUpload={(file) => {
              void handleFileChosen(file);
              return false;
            }}
          >
            <p className="ant-upload-drag-icon">
              <InboxOutlined />
            </p>
            <p className="ant-upload-text">
              {fileName || '点击或拖拽 CSV / JSONL 文件到这里'}
            </p>
            <p className="ant-upload-hint">单文件上限 50MB，数据只保存在本机浏览器</p>
          </Upload.Dragger>

          <div className={styles.options}>
            <label>
              编码
              <Select
                size="small"
                value={encoding}
                style={{ width: 150 }}
                onChange={(value) => {
                  setEncoding(value);
                  setTypeOverrides({});
                  setPending(null);
                }}
                options={[
                  { value: 'auto', label: '自动检测' },
                  { value: 'utf-8', label: 'UTF-8' },
                  { value: 'gb18030', label: 'GB18030 / GBK' },
                  { value: 'utf-16le', label: 'UTF-16 LE' },
                ]}
              />
            </label>
            <label>
              分隔符
              <Select
                size="small"
                value={delimiter}
                style={{ width: 120 }}
                onChange={(value) => {
                  setDelimiter(value);
                  setTypeOverrides({});
                  setPending(null);
                }}
                options={[
                  { value: 'auto', label: '自动检测' },
                  { value: ',', label: '逗号 ,' },
                  { value: '\t', label: '制表符 \\t' },
                  { value: ';', label: '分号 ;' },
                  { value: '|', label: '竖线 |' },
                ]}
              />
            </label>
            <label>
              首行是表头
              <Switch
                size="small"
                checked={hasHeader}
                onChange={(value) => {
                  setHasHeader(value);
                  setTypeOverrides({});
                  setPending(null);
                }}
              />
            </label>
          </div>

          {parsing && (
            <div className={styles.loadingHint}>
              正在解析{fileBytes && fileBytes.byteLength > WORKER_PARSE_THRESHOLD ? '（后台线程）' : ''}…
            </div>
          )}
          {parseError && <Alert type="error" showIcon message={parseError} />}

          {pending && (
            <>
              <div className={styles.typeRow}>
                <span className={styles.typeRowLabel}>字段类型</span>
                {pending.result.table.columns.map((column) => (
                  <label key={column.id} className={styles.typeItem}>
                    <span className={styles.typeName}>{column.name}</span>
                    <Select
                      size="small"
                      style={{ width: 84 }}
                      value={typeOverrides[column.sourceIndex] ?? 'auto'}
                      onChange={(value) => {
                        setTypeOverrides((previous) => {
                          const next = { ...previous };
                          if (value === 'auto') delete next[column.sourceIndex];
                          else next[column.sourceIndex] = value as FieldType;
                          return next;
                        });
                      }}
                      options={[
                        { value: 'auto', label: '自动' },
                        { value: 'string', label: '文本' },
                        { value: 'number', label: '数值' },
                        { value: 'date', label: '日期' },
                      ]}
                    />
                  </label>
                ))}
                <span className={styles.typeHint}>
                  日期列按 {Intl.DateTimeFormat().resolvedOptions().timeZone} 解析
                </span>
              </div>
              <Alert
                type={pending.result.badLines > 0 ? 'warning' : 'success'}
                showIcon
                message={
                  <span>
                    解析完成：{pending.result.table.rowCount} 行 ·{' '}
                    {pending.result.table.columns.length} 列 · 编码{' '}
                    {pending.result.encoding}
                    {pending.result.delimiter
                      ? ` · 分隔符「${pending.result.delimiter === '\t' ? '\\t' : pending.result.delimiter}」`
                      : ''}
                    {pending.result.badLines > 0
                      ? ` · ${pending.result.badLines} 行损坏已跳过`
                      : ''}
                  </span>
                }
                description={
                  pending.result.badLineSamples.length > 0 ? (
                    <div className={styles.badSamples}>
                      {pending.result.badLineSamples.slice(0, 3).map((line, index) => (
                        <code key={index}>{line.slice(0, 160)}</code>
                      ))}
                    </div>
                  ) : undefined
                }
              />
              <Table
                className={styles.table}
                size="small"
                bordered
                rowKey="__row"
                columns={previewCols}
                dataSource={previewData}
                pagination={{ pageSize: 10, size: 'small', showSizeChanger: false }}
                scroll={{ x: 'max-content', y: 280 }}
              />
            </>
          )}
        </div>
      </Modal>

      <Modal
        open={settingsOpen}
        title={`解析设置${selectedMeta ? ` · ${selectedMeta.name}` : ''}`}
        okText="应用并重建"
        cancelText="取消"
        confirmLoading={loading}
        onOk={() => void applyParseSettings()}
        onCancel={() => setSettingsOpen(false)}
      >
        <div className={styles.options}>
          <label>
            编码
            <Select
              size="small"
              value={editEncoding}
              style={{ width: 150 }}
              onChange={(value) => setEditEncoding(value as SupportedEncoding)}
              options={[
                { value: 'utf-8', label: 'UTF-8' },
                { value: 'gb18030', label: 'GB18030 / GBK' },
                { value: 'utf-16le', label: 'UTF-16 LE' },
              ]}
            />
          </label>
          <label>
            分隔符
            <Select
              size="small"
              value={editDelimiter}
              style={{ width: 120 }}
              onChange={setEditDelimiter}
              options={[
                { value: ',', label: '逗号 ,' },
                { value: '\t', label: '制表符 \\t' },
                { value: ';', label: '分号 ;' },
                { value: '|', label: '竖线 |' },
              ]}
            />
          </label>
          <label>
            首行是表头
            <Switch size="small" checked={editHasHeader} onChange={setEditHasHeader} />
          </label>
        </div>
        <div className={styles.options}>
          <label>
            时区
            <Input
              size="small"
              style={{ width: 200 }}
              value={editTimeZone}
              placeholder="Asia/Shanghai"
              onChange={(event) => setEditTimeZone(event.target.value)}
            />
          </label>
          <label>
            日期格式
            <Select
              size="small"
              value={editDateFormat}
              style={{ width: 160 }}
              onChange={setEditDateFormat}
              options={[
                { value: 'auto', label: '自动识别' },
                { value: 'epoch-s', label: 'Unix 秒' },
                { value: 'epoch-ms', label: 'Unix 毫秒' },
              ]}
            />
          </label>
        </div>
        <Alert
          type="info"
          showIcon
          style={{ marginTop: 12 }}
          message="修改后会从原始文件重新解析。引用列或类型发生变化的分析视图会被标记为失效。"
        />
      </Modal>
    </div>
  );
}
