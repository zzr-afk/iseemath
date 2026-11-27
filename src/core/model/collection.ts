import { FormulaError, collectCalls, collectIdentifiers, type Expr } from '@/core/formula/ast';
import { parseFormula } from '@/core/formula/parser';
import { findCycles, topologicalOrder } from '@/core/graph/cycle';
import { BUILTIN_FUNCTIONS, resolveFormulaName } from '@/core/graph/dependency';
import type {
  CollectionNode,
  DatasetMeta,
  FieldDef,
  FieldType,
  NodeId,
  Project,
} from './types';

/** Field types that can participate in numeric row formulas. */
export function isNumericFieldType(type: FieldType): boolean {
  return type === 'number' || type === 'date';
}

/** A field may map to a dataset column of the same type (enum is textual). */
export function fieldTypeCompatible(fieldType: FieldType, columnType: FieldType): boolean {
  if (fieldType === columnType) return true;
  return (
    (fieldType === 'enum' && columnType === 'string') ||
    (fieldType === 'string' && columnType === 'enum')
  );
}

/** Exact match first, then case-insensitive, mirroring formula name resolution. */
export function resolveFieldName(fields: FieldDef[], name: string): FieldDef | undefined {
  const exact = fields.find((field) => field.name === name);
  if (exact) return exact;
  const lower = name.toLocaleLowerCase();
  return fields.find((field) => field.name.toLocaleLowerCase() === lower);
}

export interface ParsedFieldFormula {
  text: string;
  ast?: Expr;
  error?: FormulaError;
}

export interface CollectionFieldAnalysis {
  /** Derived field id -> parsed formula / parse error. */
  parsed: Map<string, ParsedFieldFormula>;
  /** Derived field id -> referenced field ids (row-scope dependencies). */
  dependencies: Map<string, string[]>;
  /** Derived field id -> identifiers that are not fields (globals/curves/tables). */
  unresolved: Map<string, string[]>;
  /** Derived fields in dependency order (cycles excluded). */
  order: string[];
  /** Derived field ids inside a column-level cycle. */
  cyclic: string[];
  /** Field id -> blocking message (empty formula / parse error / cycle). */
  fieldErrors: Map<string, string>;
}

/**
 * Parse derived field formulas and derive the column-level DAG. Names resolve
 * to fields first; anything else is left for the global evaluator.
 */
export function analyzeCollectionFields(node: CollectionNode): CollectionFieldAnalysis {
  const parsed = new Map<string, ParsedFieldFormula>();
  const dependencies = new Map<string, string[]>();
  const unresolved = new Map<string, string[]>();
  const fieldErrors = new Map<string, string>();

  for (const field of node.fields) {
    if (field.role !== 'derived') continue;
    const text = field.formula ?? '';
    if (text.trim() === '') {
      fieldErrors.set(field.id, '派生列公式为空');
      dependencies.set(field.id, []);
      continue;
    }

    let ast: Expr;
    try {
      ast = parseFormula(text);
    } catch (error) {
      const formulaError =
        error instanceof FormulaError
          ? error
          : new FormulaError(String(error), 0, 'PARSE_ERROR');
      parsed.set(field.id, { text, error: formulaError });
      dependencies.set(field.id, []);
      fieldErrors.set(field.id, formulaError.message);
      continue;
    }
    parsed.set(field.id, { text, ast });

    const names = new Set<string>();
    for (const identifier of collectIdentifiers(ast)) names.add(identifier);
    for (const call of collectCalls(ast)) names.add(call);

    const deps = new Set<string>();
    const globals: string[] = [];
    for (const name of names) {
      if (BUILTIN_FUNCTIONS.has(name)) continue;
      const referenced = resolveFieldName(node.fields, name);
      if (referenced) {
        deps.add(referenced.id);
        if (!isNumericFieldType(referenced.type)) {
          fieldErrors.set(field.id, `公式引用了非数值字段「${referenced.name}」`);
        }
      } else {
        globals.push(name);
      }
    }
    dependencies.set(field.id, [...deps]);
    if (globals.length > 0) unresolved.set(field.id, globals);
  }

  const derivedIds = node.fields.filter((field) => field.role === 'derived').map((f) => f.id);
  const { cycles, inCycle } = findCycles(dependencies);
  const { order, cyclic } = topologicalOrder(derivedIds, dependencies);
  for (const id of cyclic) {
    // Kahn leaves both cycle members and their dependents unordered; only mark
    // the true SCC members as cycles and let dependents report via evaluation.
    if (inCycle.has(id)) fieldErrors.set(id, '派生列存在循环引用');
  }
  for (const component of cycles) {
    for (const id of component) fieldErrors.set(id, '派生列存在循环引用');
  }
  // Kahn also leaves every downstream dependent unordered; those are blocked by
  // the cycle but are not themselves part of it.
  const ordered = new Set(order);
  for (const id of derivedIds) {
    if (!ordered.has(id) && !inCycle.has(id) && !fieldErrors.has(id)) {
      fieldErrors.set(id, '依赖的派生列存在循环引用');
    }
  }

  return { parsed, dependencies, unresolved, order, cyclic, fieldErrors };
}

/**
 * Empty/duplicate/invalid dataset bindings. Returns the reason a collection
 * cannot be evaluated, or null when it is structurally usable.
 */
export function collectionBindingIssue(node: CollectionNode, dataset?: DatasetMeta): string | null {
  if (!dataset) return '绑定的数据集不存在';
  if (dataset.dataUnavailable) return '数据集不可用';
  for (const field of node.fields) {
    if (field.role !== 'input') continue;
    if (!field.sourceColumnId) return `字段「${field.name}」未映射列`;
    const column = dataset.columns.find((candidate) => candidate.id === field.sourceColumnId);
    if (!column) return `字段「${field.name}」引用的列已不存在`;
    if (!fieldTypeCompatible(field.type, column.type)) {
      return `字段「${field.name}」类型与列「${column.name}」不兼容`;
    }
  }
  return null;
}

export function hasMissingFields(node: CollectionNode): boolean {
  return node.fields.some((field) => field.missing);
}

/**
 * Re-validate every collection bound to `datasetId` after the dataset schema,
 * availability or source changed. Mutates the draft (command/system body).
 * Returns true when any flag changed.
 */
export function revalidateCollectionFields(project: Project, datasetId: string): boolean {
  const dataset = project.datasets.find((candidate) => candidate.id === datasetId);
  let changed = false;
  for (const node of Object.values(project.nodes)) {
    if (node.kind !== 'collection' || node.datasetId !== datasetId) continue;
    let missing = !dataset || Boolean(dataset.dataUnavailable);
    for (const field of node.fields) {
      let fieldMissing = false;
      if (field.role === 'input') {
        const column = dataset?.columns.find((candidate) => candidate.id === field.sourceColumnId);
        fieldMissing = !column || !fieldTypeCompatible(field.type, column.type);
      }
      if (Boolean(field.missing) !== fieldMissing) {
        field.missing = fieldMissing;
        changed = true;
      }
      if (fieldMissing) missing = true;
    }
    if (Boolean(node.dataMissing) !== missing) {
      node.dataMissing = missing;
      changed = true;
    }
  }
  return changed;
}

/** Every global identifier a field name would shadow. */
export function findGlobalNameConflict(project: Project, name: string): string | null {
  const lower = name.toLocaleLowerCase();
  if (BUILTIN_FUNCTIONS.has(name) || name === 'PI' || name === 'E' || name === 'true' || name === 'false') {
    return `名称「${name}」与内置函数/常量冲突`;
  }
  const variable = Object.values(project.nodes).find(
    (node) => node.kind === 'variable' && node.name.toLocaleLowerCase() === lower,
  );
  if (variable) return `名称「${name}」与变量「${variable.label}」冲突`;
  return null;
}

/**
 * Validate a field name inside its collection and against the global symbol
 * space. Returns a user-facing message or null.
 */
export function findFieldNameConflict(
  project: Project,
  collectionId: NodeId,
  name: string,
  selfFieldId?: string,
): string | null {
  const trimmed = name.trim();
  if (!trimmed) return '字段名不能为空';
  const globalConflict = findGlobalNameConflict(project, trimmed);
  if (globalConflict) return globalConflict;
  const node = project.nodes[collectionId];
  if (!node || node.kind !== 'collection') return '数据表不存在';
  const lower = trimmed.toLocaleLowerCase();
  if (
    node.fields.some(
      (field) => field.id !== selfFieldId && field.name.toLocaleLowerCase() === lower,
    )
  ) {
    return `字段名「${trimmed}」已存在`;
  }
  return null;
}

/** Variable creation/rename validation against every collection field name. */
export function findFieldConflictForVariable(project: Project, name: string): string | null {
  const lower = name.toLocaleLowerCase();
  for (const node of Object.values(project.nodes)) {
    if (node.kind !== 'collection') continue;
    const field = node.fields.find((candidate) => candidate.name.toLocaleLowerCase() === lower);
    if (field) return `名称「${name}」与数据表「${node.label}」的字段冲突`;
  }
  return null;
}

/** Derived field ids that are fields in the collection (helper for editors). */
export function fieldNames(node: CollectionNode): string[] {
  return node.fields.map((field) => field.name);
}

/** Resolve a variable name to a numeric value, if the variable is scalar. */
export function isScalarVariable(project: Project, name: string): boolean {
  const variables = Object.values(project.nodes).filter((node) => node.kind === 'variable');
  return Boolean(resolveFormulaName(name, variables));
}
