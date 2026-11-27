import { FormulaError, type Expr } from '@/core/formula/ast';
import { evaluateNumber, type Value } from '@/core/formula/evaluator';
import { buildDependencyGraph, resolveFormulaName } from '@/core/graph/dependency';
import { findCycles, topologicalOrder } from '@/core/graph/cycle';
import type {
  CurveData,
  NodeId,
  Project,
  TableData,
  VariableNode,
} from '@/core/model/types';

export interface ProjectEvaluation {
  values: Record<NodeId, number | undefined>;
  errors: Record<NodeId, string | undefined>;
  dependencyEdges: { source: NodeId; target: NodeId }[];
  cycles: NodeId[][];
}

export function curveValue(curve: CurveData, x: number): number {
  const points = [...curve.points].sort((a, b) => a.x - b.x);
  if (points.length === 0) throw new Error('曲线没有数据点');
  const first = points[0]!;
  const last = points[points.length - 1]!;

  if (x < first.x || x > last.x) {
    if (curve.extrapolation === 'error') throw new Error('曲线外推超出范围');
    if (curve.extrapolation === 'clamp') return x < first.x ? first.y : last.y;
  }

  let index = 0;
  while (index < points.length - 1 && points[index + 1]!.x < x) index += 1;
  const left = points[index]!;
  const right = points[Math.min(index + 1, points.length - 1)]!;

  if (curve.interpolation === 'step') return left.y;
  if (right.x === left.x) return left.y;
  return left.y + ((right.y - left.y) * (x - left.x)) / (right.x - left.x);
}

export function tableValue(table: TableData, key: Value, columnName: Value): number {
  if (typeof columnName !== 'string') throw new Error('表格列选择必须是字符串字面量');
  const column = table.columns.find((item) => item.name === columnName);
  if (!column) throw new Error(`表格列不存在：${columnName}`);
  const columnIndex = table.columns.findIndex((item) => item.id === column.id);
  const keyColumnIndex = table.columns.findIndex((item) => item.id === table.keyColumn);
  if (keyColumnIndex < 0) throw new Error('表格 key 列无效');

  const rows = table.rows;
  if (table.lookup === 'exact' || typeof key !== 'number') {
    const row = rows.find((item) => item[keyColumnIndex] === key);
    if (!row) throw new Error(`表格中没有 key：${String(key)}`);
    const value = row[columnIndex];
    if (typeof value !== 'number') throw new Error('表格目标列不是数值');
    return value;
  }

  const numericRows = rows
    .map((row) => ({ key: row[keyColumnIndex], value: row[columnIndex] }))
    .filter(
      (row): row is { key: number; value: number } =>
        typeof row.key === 'number' && typeof row.value === 'number',
    )
    .sort((a, b) => a.key - b.key);
  if (numericRows.length === 0) throw new Error('表格没有可线性插值的数值行');
  if (key <= numericRows[0]!.key) return numericRows[0]!.value;
  if (key >= numericRows[numericRows.length - 1]!.key) return numericRows[numericRows.length - 1]!.value;
  for (let index = 0; index < numericRows.length - 1; index++) {
    const left = numericRows[index]!;
    const right = numericRows[index + 1]!;
    if (key >= left.key && key <= right.key) {
      if (right.key === left.key) return left.value;
      return left.value + ((right.value - left.value) * (key - left.key)) / (right.key - left.key);
    }
  }
  return numericRows[numericRows.length - 1]!.value;
}

export function evaluateProject(project: Project): ProjectEvaluation {
  const variables = Object.values(project.nodes).filter(
    (node): node is VariableNode => node.kind === 'variable',
  );
  const graph = buildDependencyGraph(project);
  const nodeIds = variables.map((node) => node.id);
  const { cycles, inCycle } = findCycles(graph.dependencies);
  const { order, cyclic } = topologicalOrder(nodeIds, graph.dependencies);

  const values: Record<NodeId, number | undefined> = {};
  const errors: Record<NodeId, string | undefined> = {};
  const byId = new Map(variables.map((node) => [node.id, node]));

  for (const nodeId of nodeIds) {
    if (inCycle.has(nodeId) || cyclic.includes(nodeId)) {
      errors[nodeId] = '循环引用';
    }
  }

  function getByName(name: string): number | undefined {
    const target = resolveFormulaName(name, variables);
    return target ? values[target.id] : undefined;
  }

  function callUser(name: string, args: Value[]): number {
    const target = resolveFormulaName(name, variables);
    if (!target) throw new FormulaError(`未知函数：${name}`, 0, 'UNKNOWN_FUNCTION');
    if (target.variableKind === 'curve') {
      if (!target.curve) throw new Error('曲线数据缺失');
      if (args.length !== 1 || typeof args[0] !== 'number') {
        throw new Error(`曲线 ${name} 需要 1 个数值参数`);
      }
      return curveValue(target.curve, args[0]);
    }
    if (target.variableKind === 'table') {
      if (!target.table) throw new Error('表格数据缺失');
      if (args.length !== 2) throw new Error(`表格 ${name} 需要 2 个参数`);
      return tableValue(target.table, args[0]!, args[1]!);
    }
    throw new Error(`${name} 不是可调用对象`);
  }

  for (const nodeId of order) {
    const node = byId.get(nodeId);
    if (!node) continue;
    if (errors[nodeId]) continue;

    if (node.variableKind === 'constant') {
      values[nodeId] = node.value ?? 0;
      continue;
    }

    if (node.variableKind === 'curve' || node.variableKind === 'table') {
      values[nodeId] = undefined;
      continue;
    }

    const parsed = graph.parsed.get(nodeId);
    if (!parsed || !parsed.ast) {
      errors[nodeId] = parsed?.error?.message ?? '公式为空';
      continue;
    }
    const unresolved = graph.unresolved.get(nodeId);
    if (unresolved && unresolved.length > 0) {
      errors[nodeId] = `未知变量：${unresolved.join('、')}`;
      continue;
    }

    try {
      values[nodeId] = evaluateNumber(parsed.ast as Expr, {
        getVariable: getByName,
        callUser,
      });
    } catch (error) {
      if (error instanceof FormulaError) {
        errors[nodeId] = error.message;
      } else {
        errors[nodeId] = error instanceof Error ? error.message : String(error);
      }
    }
  }

  const dependencyEdges: { source: NodeId; target: NodeId }[] = [];
  for (const [target, sources] of graph.dependencies) {
    for (const source of sources) {
      dependencyEdges.push({ source, target });
    }
  }

  return { values, errors, dependencyEdges, cycles };
}
