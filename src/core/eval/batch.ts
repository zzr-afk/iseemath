import { FormulaError } from '@/core/formula/ast';
import { evaluateNumber, type Value } from '@/core/formula/evaluator';
import { resolveFormulaName } from '@/core/graph/dependency';
import {
  analyzeCollectionFields,
  isNumericFieldType,
  resolveFieldName,
} from '@/core/model/collection';
import type { CollectionNode, Project, VariableNode } from '@/core/model/types';
import type { ColumnarTable } from '@/core/logs/parse';
import { curveValue, evaluateProject, tableValue, type ProjectEvaluation } from './projectEval';

export interface BatchFieldResult {
  fieldId: string;
  /** False for string/enum input fields, which are shown but not computed. */
  numeric: boolean;
  values: Float64Array;
  valid: Uint8Array;
  /** Present for textual input fields. */
  textValues?: (string | undefined)[];
  errorRows: number;
  nullRows: number;
  badRows: number;
  firstError?: { row: number; message: string };
}

export interface CollectionBatchResult {
  rowCount: number;
  /** Derived field ids in dependency order. */
  order: string[];
  fields: Record<string, BatchFieldResult>;
  /** Field-level blocking errors (empty formula, cycle, missing column...). */
  fieldErrors: Record<string, string>;
  /** Rows where at least one derived field failed. */
  errorRows: number;
}

function emptyField(fieldId: string, rowCount: number, numeric: boolean): BatchFieldResult {
  return {
    fieldId,
    numeric,
    values: new Float64Array(rowCount),
    valid: new Uint8Array(rowCount),
    textValues: numeric ? undefined : new Array<string | undefined>(rowCount),
    errorRows: 0,
    nullRows: 0,
    badRows: 0,
  };
}

function columnIndexFor(table: ColumnarTable, columnId: string | undefined): number {
  if (!columnId) return -1;
  return table.columns.findIndex((column) => column.id === columnId);
}

/**
 * Evaluate every derived field of a collection over the bound dataset, row by
 * row, resolving row-scope field names first and global variables/curves/tables
 * second. Pure: no store access, safe in a worker.
 */
export function evaluateCollectionColumns(
  project: Project,
  node: CollectionNode,
  table: ColumnarTable,
  globalEvaluation: ProjectEvaluation = evaluateProject(project),
): CollectionBatchResult {
  const rowCount = table.rowCount;
  const analysis = analyzeCollectionFields(node);
  const fields: Record<string, BatchFieldResult> = {};
  const fieldErrors: Record<string, string> = Object.fromEntries(analysis.fieldErrors);
  const variables = Object.values(project.nodes).filter(
    (candidate): candidate is VariableNode => candidate.kind === 'variable',
  );

  for (const field of node.fields) {
    if (field.role === 'input') {
      const index = columnIndexFor(table, field.sourceColumnId);
      if (index < 0) {
        fieldErrors[field.id] = '引用的数据集列不存在';
        fields[field.id] = emptyField(field.id, rowCount, isNumericFieldType(field.type));
        continue;
      }
      const vector = table.vectors[index]!;
      if (isNumericFieldType(field.type)) {
        if (vector.type !== 'number' && vector.type !== 'date') {
          fieldErrors[field.id] = '映射列不是数值/日期类型';
          fields[field.id] = emptyField(field.id, rowCount, true);
          continue;
        }
        fields[field.id] = {
          fieldId: field.id,
          numeric: true,
          values: Float64Array.from(vector.values),
          valid: Uint8Array.from(vector.valid),
          errorRows: 0,
          nullRows: vector.nullCount,
          badRows: vector.badCount,
        };
      } else {
        const text = vector.type === 'string' || vector.type === 'enum' ? vector.values : null;
        fields[field.id] = {
          fieldId: field.id,
          numeric: false,
          values: new Float64Array(rowCount),
          valid: Uint8Array.from(vector.valid),
          textValues: Array.from({ length: rowCount }, (_, row) => text?.[row]),
          errorRows: 0,
          nullRows: vector.nullCount,
          badRows: vector.badCount,
        };
      }
      continue;
    }

    const result = emptyField(field.id, rowCount, true);
    fields[field.id] = result;
    if (fieldErrors[field.id]) continue;

    const parsed = analysis.parsed.get(field.id);
    if (!parsed?.ast) {
      fieldErrors[field.id] = parsed?.error?.message ?? '派生列公式为空';
      continue;
    }
    const ast = parsed.ast;

    for (let row = 0; row < rowCount; row += 1) {
      try {
        const value = evaluateNumber(ast, {
          getVariable: (name) => {
            const target = resolveFieldName(node.fields, name);
            if (target) {
              const source = fields[target.id];
              if (!source || !source.numeric) {
                throw new FormulaError(`字段「${name}」不可用`, 0, 'MISSING_FIELD');
              }
              if (source.valid[row] !== 1) {
                throw new FormulaError(`字段「${name}」在该行为空`, 0, 'MISSING_FIELD');
              }
              return source.values[row];
            }
            return resolveGlobal(name);
          },
          callUser,
          maxSteps: 50_000,
        });
        result.values[row] = value;
        result.valid[row] = 1;
      } catch (error) {
        const message = error instanceof FormulaError ? error.message : String(error);
        result.errorRows += 1;
        if (!result.firstError) result.firstError = { row, message };
      }
    }
  }

  function resolveGlobal(name: string): number {
    const target = resolveFormulaName(name, variables);
    if (!target) throw new FormulaError(`未知变量：${name}`, 0, 'UNKNOWN_IDENTIFIER');
    const value = globalEvaluation.values[target.id];
    if (value === undefined || !Number.isFinite(value)) {
      throw new FormulaError(`变量「${name}」没有有效数值`, 0, 'MISSING_GLOBAL');
    }
    return value;
  }

  function callUser(name: string, args: Value[]): number {
    const target = resolveFormulaName(name, variables);
    if (!target) throw new FormulaError(`未知函数：${name}`, 0, 'UNKNOWN_FUNCTION');
    if (target.variableKind === 'curve') {
      if (!target.curve) throw new FormulaError('曲线数据缺失', 0);
      if (args.length !== 1 || typeof args[0] !== 'number') {
        throw new FormulaError(`曲线 ${name} 需要 1 个数值参数`, 0);
      }
      return curveValue(target.curve, args[0]);
    }
    if (target.variableKind === 'table') {
      if (!target.table) throw new FormulaError('表格数据缺失', 0);
      if (args.length !== 2) throw new FormulaError(`表格 ${name} 需要 2 个参数`, 0);
      return tableValue(target.table, args[0]!, args[1]!);
    }
    throw new FormulaError(`${name} 不是可调用对象`, 0);
  }

  let errorRows = 0;
  for (let row = 0; row < rowCount; row += 1) {
    let failed = false;
    for (const field of node.fields) {
      if (field.role !== 'derived') continue;
      const result = fields[field.id]!;
      if (result.errorRows > 0 && result.valid[row] !== 1) {
        failed = true;
        break;
      }
    }
    if (failed) errorRows += 1;
  }

  return {
    rowCount,
    order: analysis.order,
    fields,
    fieldErrors,
    errorRows,
  };
}

/** Names of globals referenced by the collection's derived fields (type-level deps). */
export function collectionGlobalDependencies(
  project: Project,
  node: CollectionNode,
): VariableNode[] {
  const analysis = analyzeCollectionFields(node);
  const variables = Object.values(project.nodes).filter(
    (candidate): candidate is VariableNode => candidate.kind === 'variable',
  );
  const found = new Map<string, VariableNode>();
  for (const names of analysis.unresolved.values()) {
    for (const name of names) {
      const target = resolveFormulaName(name, variables);
      if (target) found.set(target.id, target);
    }
  }
  return [...found.values()];
}

/** Field summary for canvas cards and inspectors. */
export function collectionSummary(node: CollectionNode, rowCount: number): string {
  const derived = node.fields.filter((field) => field.role === 'derived').length;
  return `${rowCount} 行 · ${node.fields.length} 字段${derived > 0 ? ` · ${derived} 派生` : ''}`;
}
