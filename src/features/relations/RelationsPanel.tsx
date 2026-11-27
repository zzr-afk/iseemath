import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Empty, Input, InputNumber, Tooltip, message } from 'antd';
import { CloseOutlined, DisconnectOutlined, PlusOutlined, SearchOutlined } from '@ant-design/icons';
import { useProjectStore } from '@/stores/projectStore';
import { useRuntimeStore } from '@/stores/runtimeStore';
import { useUiStore } from '@/stores/uiStore';
import { updateNode } from '@/core/model/commands';
import { createVariableNode } from '@/core/model/factories';
import { findFieldConflictForVariable } from '@/core/model/collection';
import { buildDependencyGraph } from '@/core/graph/dependency';
import type { Value } from '@/core/formula/evaluator';
import FormulaEditor, { FUNCTION_NAMES } from '@/features/formula/FormulaEditor';
import { formatNumber } from '@/utils/format';
import { nextNodePosition, uniqueNodeName } from '@/features/canvas/placement';
import type { AnyNode, NodeId, VariableNode } from '@/core/model/types';
import {
  collectRelationRows,
  formulaFromConstant,
  type RelationRow,
} from './relations';
import {
  buildLocalProgram,
  evaluateLocalValues,
  nextLocalName,
  parseLocalProgram,
  renameLocalBinding,
  validateLocalName,
  type LocalBinding,
} from './locals';
import styles from './RelationsPanel.module.css';

function ConstantValueInput({
  value,
  disabled,
  onCommit,
}: {
  value: number;
  disabled: boolean;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const commit = () => {
    if (draft !== value) onCommit(draft);
  };

  return (
    <InputNumber
      size="small"
      value={draft}
      disabled={disabled}
      onChange={(next) => setDraft(next ?? 0)}
      onBlur={commit}
      onPressEnter={commit}
      style={{ width: 110 }}
    />
  );
}

interface LocalDraftRow extends LocalBinding {
  id: string;
}

let localRowSeq = 0;
function nextLocalRowId(): string {
  localRowSeq += 1;
  return `local-${localRowSeq}`;
}

function formatLocalValue(value: Value | undefined): string {
  if (value === undefined) return '—';
  if (typeof value === 'number') return formatNumber(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return `"${value}"`;
}

function LocalNameInput({
  value,
  disabled,
  validate,
  onCommit,
}: {
  value: string;
  disabled: boolean;
  validate: (name: string) => string | null;
  onCommit: (name: string) => void;
}) {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const commit = () => {
    const name = draft.trim();
    if (name === value) {
      setDraft(value);
      return;
    }
    const error = validate(name);
    if (error) {
      message.error(error);
      setDraft(value);
      return;
    }
    onCommit(name);
  };

  return (
    <Input
      size="small"
      className={styles.localName}
      value={draft}
      disabled={disabled}
      spellCheck={false}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onPressEnter={commit}
      onFocus={(event) => event.currentTarget.select()}
    />
  );
}

interface RelationFormulaEditorProps {
  formula: string;
  completions: string[];
  globals: Map<string, number>;
  disabled: boolean;
  onCommit: (formula: string) => void;
}

/**
 * One relation, edited as a small local scope: zero or more `name = expression`
 * definitions followed by the result. The stored formula stays in the canonical
 * `let a = ...; let b = ...; result` form, so the engine, dependency graph and
 * rename logic need no changes.
 */
function RelationFormulaEditor({
  formula,
  completions,
  globals,
  disabled,
  onCommit,
}: RelationFormulaEditorProps) {
  const initialProgram = useRef<{ bindings: LocalBinding[]; result: string } | null>(null);
  if (initialProgram.current === null) {
    initialProgram.current = parseLocalProgram(formula) ?? { bindings: [], result: formula };
  }

  const [bindings, setBindingsState] = useState<LocalDraftRow[]>(() =>
    initialProgram.current!.bindings.map((binding) => ({
      ...binding,
      id: nextLocalRowId(),
    })),
  );
  const [result, setResultState] = useState(initialProgram.current.result);
  const bindingsRef = useRef(bindings);
  const resultRef = useRef(result);
  const lastEmitted = useRef(formula);

  const applyBindings = (next: LocalDraftRow[]) => {
    bindingsRef.current = next;
    setBindingsState(next);
  };
  const applyResult = (next: string) => {
    resultRef.current = next;
    setResultState(next);
  };

  // The formula can change behind our back (undo, AI import, another panel).
  // Our own commits update `lastEmitted` first, so they do not reset the draft.
  useEffect(() => {
    if (formula === lastEmitted.current) return;
    lastEmitted.current = formula;
    const parsed = parseLocalProgram(formula);
    if (!parsed) {
      const nextBindings: LocalDraftRow[] = [];
      bindingsRef.current = nextBindings;
      resultRef.current = formula;
      setBindingsState(nextBindings);
      setResultState(formula);
      return;
    }
    const nextBindings = parsed.bindings.map((binding) => ({
      ...binding,
      id: nextLocalRowId(),
    }));
    bindingsRef.current = nextBindings;
    resultRef.current = parsed.result;
    setBindingsState(nextBindings);
    setResultState(parsed.result);
  }, [formula]);

  const emit = useCallback(
    (nextBindings: LocalDraftRow[], nextResult: string) => {
      const next = buildLocalProgram({ bindings: nextBindings, result: nextResult });
      if (next === lastEmitted.current) return;
      lastEmitted.current = next;
      onCommit(next);
    },
    [onCommit],
  );

  const updateExpression = (index: number, expression: string) => {
    const next = bindingsRef.current.map((binding, position) =>
      position === index ? { ...binding, expression } : binding,
    );
    applyBindings(next);
    emit(next, resultRef.current);
  };

  const updateResult = (text: string) => {
    applyResult(text);
    emit(bindingsRef.current, text);
  };

  const addLocal = () => {
    const current = bindingsRef.current;
    const next = [
      ...current,
      {
        id: nextLocalRowId(),
        name: nextLocalName(current.map((binding) => binding.name)),
        expression: '0',
      },
    ];
    applyBindings(next);
    emit(next, resultRef.current);
  };

  const removeLocal = (index: number) => {
    const next = bindingsRef.current.filter((_, position) => position !== index);
    applyBindings(next);
    emit(next, resultRef.current);
  };

  const renameLocal = (index: number, name: string) => {
    const current = bindingsRef.current;
    const renamed = renameLocalBinding(current, resultRef.current, index, name);
    const nextBindings = renamed.bindings.map((binding, position) => ({
      ...binding,
      id: current[position]!.id,
    }));
    applyBindings(nextBindings);
    applyResult(renamed.result);
    emit(nextBindings, renamed.result);
  };

  const localValues = useMemo(
    () => evaluateLocalValues(bindings, globals),
    [bindings, globals],
  );
  const rowCompletions = useMemo(
    () => [...completions, ...bindings.map((binding) => binding.name)],
    [completions, bindings],
  );

  return (
    <div className={styles.formulaEditor}>
      {bindings.length > 0 ? (
        <div className={styles.localList}>
          <div className={styles.localHint}>局部量 · 只在本条关系内有效</div>
          {bindings.map((binding, index) => (
            <div key={binding.id} className={styles.localRow}>
              <LocalNameInput
                value={binding.name}
                disabled={disabled}
                validate={(name) =>
                  validateLocalName(
                    name,
                    bindingsRef.current
                      .filter((_, position) => position !== index)
                      .map((other) => other.name),
                  )
                }
                onCommit={(name) => renameLocal(index, name)}
              />
              <span className={styles.localEquals}>=</span>
              <div className={styles.localInput}>
                <FormulaEditor
                  compact
                  value={binding.expression}
                  onChange={() => {}}
                  onCommit={(text) => updateExpression(index, text)}
                  completions={rowCompletions}
                  placeholder="表达式"
                />
              </div>
              <Tooltip title="局部量当前值">
                <span className={styles.localValue}>{formatLocalValue(localValues[index])}</span>
              </Tooltip>
              <Tooltip title="删除局部量">
                <Button
                  type="text"
                  size="small"
                  className={styles.localRemove}
                  disabled={disabled}
                  icon={<CloseOutlined />}
                  onClick={() => removeLocal(index)}
                />
              </Tooltip>
            </div>
          ))}
        </div>
      ) : null}

      <div className={styles.resultRow}>
        {bindings.length > 0 ? <span className={styles.resultLabel}>结果</span> : null}
        <div className={styles.resultInput}>
          <FormulaEditor
            compact
            value={result}
            onChange={() => {}}
            onCommit={updateResult}
            completions={rowCompletions}
            placeholder="输入公式，例如 攻击力 * 2 + 100"
          />
        </div>
        <Tooltip title="添加局部量（只在这条关系内有效）">
          <Button
            type="text"
            size="small"
            className={styles.addLocal}
            disabled={disabled}
            icon={<PlusOutlined />}
            onClick={addLocal}
          />
        </Tooltip>
      </div>
    </div>
  );
}

interface RelationRowViewProps {
  row: RelationRow;
  value: number | undefined;
  error: string | undefined;
  completions: string[];
  globals: Map<string, number>;
  focused: boolean;
  focusNonce: number;
  readOnly: boolean;
  setRowRef: (element: HTMLDivElement | null) => void;
  onSelect: () => void;
  onCommitFormula: (formula: string) => void;
  onDefineRelation: () => void;
  onFreezeRelation: () => void;
  onCommitValue: (value: number) => void;
}

function RelationRowView({
  row,
  value,
  error,
  completions,
  globals,
  focused,
  focusNonce,
  readOnly,
  setRowRef,
  onSelect,
  onCommitFormula,
  onDefineRelation,
  onFreezeRelation,
  onCommitValue,
}: RelationRowViewProps) {
  const node = row.node;
  const isFormula = node.variableKind === 'formula';

  return (
    <div className={styles.row} ref={setRowRef} data-relation-id={node.id}>
      {focused ? <span key={focusNonce} className={styles.flash} aria-hidden /> : null}
      <div className={styles.target}>
        <button type="button" className={styles.nameButton} title="在画布中选中" onClick={onSelect}>
          {node.label}
        </button>
        {node.label !== node.name ? <span className={styles.symbol}>{node.name}</span> : null}
      </div>

      <div className={styles.formulaCell}>
        {isFormula ? (
          <>
            <RelationFormulaEditor
              formula={node.formula ?? ''}
              completions={completions}
              globals={globals}
              disabled={readOnly}
              onCommit={onCommitFormula}
            />
            {row.sources.length > 0 ? (
              <div className={styles.sourceLine}>
                <span>来源</span>
                {row.sources.map((source) => (
                  <span key={source.id} className={styles.sourceChip}>
                    {source.name}
                  </span>
                ))}
              </div>
            ) : null}
          </>
        ) : (
          <div className={styles.constantCell}>
            <ConstantValueInput
              value={node.value ?? 0}
              disabled={readOnly}
              onCommit={onCommitValue}
            />
            <Button
              type="link"
              size="small"
              disabled={readOnly}
              onClick={onDefineRelation}
              style={{ padding: '0 2px', height: 24, fontSize: 11.5 }}
            >
              写关系
            </Button>
          </div>
        )}
      </div>

      <div className={styles.valueCell}>
        {error ? (
          <Tooltip title={error}>
            <span className={styles.valueError}>{error}</span>
          </Tooltip>
        ) : (
          <span className={styles.value}>{formatNumber(value, node.precision)}</span>
        )}
      </div>

      <div className={styles.actions}>
        {isFormula ? (
          <Tooltip title="删除关系，把当前结果冻结为固定值">
            <Button
              type="text"
              size="small"
              disabled={readOnly}
              icon={<DisconnectOutlined />}
              onClick={onFreezeRelation}
            />
          </Tooltip>
        ) : null}
      </div>
    </div>
  );
}

export default function RelationsPanel() {
  const project = useProjectStore((state) => state.project);
  const runCommand = useProjectStore((state) => state.runCommand);
  const readOnly = useProjectStore((state) => state.readOnly);
  const values = useRuntimeStore((state) => state.values);
  const errors = useRuntimeStore((state) => state.errors);
  const selectNodes = useUiStore((state) => state.selectNodes);
  const focusRelation = useUiStore((state) => state.focusRelation);
  const focusedRelationId = useUiStore((state) => state.focusedRelationId);
  const relationFocusNonce = useUiStore((state) => state.relationFocusNonce);

  const [search, setSearch] = useState('');
  const rowRefs = useRef(new Map<NodeId, HTMLDivElement>());

  const graph = useMemo(() => buildDependencyGraph(project), [project]);
  const rows = useMemo(
    () => collectRelationRows(project, graph.dependencies),
    [project, graph],
  );
  const completions = useMemo(() => {
    const names = Object.values(project.nodes)
      .filter((node) => node.kind === 'variable')
      .map((node) => node.name);
    return Array.from(new Set([...names, 'PI', 'E', ...FUNCTION_NAMES]));
  }, [project.nodes]);
  const globals = useMemo(() => {
    const map = new Map<string, number>();
    for (const node of Object.values(project.nodes)) {
      if (node.kind !== 'variable') continue;
      const value = values[node.id];
      if (typeof value === 'number' && Number.isFinite(value)) {
        map.set(node.name.toLocaleLowerCase(), value);
      }
    }
    return map;
  }, [project.nodes, values]);

  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    if (!query) return rows;
    return rows.filter(
      (row) =>
        row.node.label.toLocaleLowerCase().includes(query) ||
        row.node.name.toLocaleLowerCase().includes(query) ||
        (row.node.formula ?? '').toLocaleLowerCase().includes(query),
    );
  }, [rows, search]);

  const formulaCount = rows.filter((row) => row.node.variableKind === 'formula').length;
  const inputCount = rows.length - formulaCount;

  useEffect(() => {
    if (!focusedRelationId) return;
    setSearch('');
  }, [focusedRelationId, relationFocusNonce]);

  useEffect(() => {
    if (!focusedRelationId) return;
    const element = rowRefs.current.get(focusedRelationId);
    if (element) element.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [focusedRelationId, relationFocusNonce, filtered]);

  const setRowRef = useCallback(
    (id: NodeId) => (element: HTMLDivElement | null) => {
      if (element) rowRefs.current.set(id, element);
      else rowRefs.current.delete(id);
    },
    [],
  );

  function updateRow(
    nodeId: NodeId,
    labelText: string,
    patch: Partial<AnyNode>,
  ): void {
    try {
      runCommand(labelText, (draft) => updateNode(draft, nodeId, patch));
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  }

  function defineRelation(node: VariableNode) {
    updateRow(node.id, '定义关系', {
      variableKind: 'formula',
      formula: formulaFromConstant(node),
      value: undefined,
      ...(node.role === 'input' ? { role: 'intermediate' as const } : {}),
    });
    focusRelation(node.id);
  }

  function freezeRelation(node: VariableNode) {
    const current = values[node.id];
    updateRow(node.id, '删除关系', {
      variableKind: 'constant',
      value: typeof current === 'number' && Number.isFinite(current) ? current : 0,
      formula: undefined,
      role: 'input',
    });
  }

  function addVariable() {
    if (readOnly) {
      message.warning('当前标签页为只读');
      return;
    }
    const node = createVariableNode(uniqueNodeName(project, '变量'), nextNodePosition(project), {
      variableKind: 'constant',
      role: 'input',
      value: 0,
    });
    const conflict = findFieldConflictForVariable(project, node.name);
    if (conflict) {
      message.error(conflict);
      return;
    }
    try {
      runCommand('新建变量', (draft) => {
        draft.nodes[node.id] = node;
        draft.updatedAt = Date.now();
      });
      selectNodes([node.id]);
      focusRelation(node.id);
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <div className={styles.panel}>
      <div className={styles.toolbar}>
        <Input
          size="small"
          allowClear
          prefix={<SearchOutlined />}
          placeholder="搜索变量或公式"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className={styles.search}
        />
        <span className={styles.counts}>
          {formulaCount} 条关系 · {inputCount} 个输入
        </span>
        <span className={styles.spacer} />
        <span className={styles.hint}>公式写在这里，画布箭头自动生成</span>
        <Button
          size="small"
          icon={<PlusOutlined />}
          disabled={readOnly}
          onClick={addVariable}
        >
          变量
        </Button>
      </div>

      <div className={styles.headerRow}>
        <span>变量</span>
        <span>关系式 / 输入值</span>
        <span className={styles.valueHeader}>当前值</span>
        <span />
      </div>

      <div className={styles.list}>
        {rows.length === 0 ? (
          <div className={styles.empty}>
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                <span style={{ color: 'var(--text-muted)' }}>
                  还没有数值量。点右上角「变量」新建，再给它写一条关系。
                </span>
              }
            />
          </div>
        ) : filtered.length === 0 ? (
          <div className={styles.empty}>
            <span style={{ color: 'var(--text-muted)' }}>没有匹配的变量。</span>
          </div>
        ) : (
          filtered.map((row) => {
            const node = row.node;
            return (
              <RelationRowView
                key={node.id}
                row={row}
                value={values[node.id]}
                error={errors[node.id]}
                completions={completions}
                globals={globals}
                focused={focusedRelationId === node.id}
                focusNonce={relationFocusNonce}
                readOnly={readOnly}
                setRowRef={setRowRef(node.id)}
                onSelect={() => selectNodes([node.id])}
                onCommitFormula={(formula) => {
                  if (formula !== (node.formula ?? '')) {
                    updateRow(node.id, '修改公式', { formula });
                  }
                }}
                onDefineRelation={() => defineRelation(node)}
                onFreezeRelation={() => freezeRelation(node)}
                onCommitValue={(value) => updateRow(node.id, '修改输入值', { value })}
              />
            );
          })
        )}
      </div>
    </div>
  );
}
