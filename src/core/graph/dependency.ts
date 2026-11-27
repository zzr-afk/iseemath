import { FormulaError, collectCalls, collectIdentifiers, type Expr } from '@/core/formula/ast';
import { parseFormula } from '@/core/formula/parser';
import type { NodeId, Project, VariableNode } from '@/core/model/types';

export interface ParsedFormula {
  text: string;
  ast?: Expr;
  error?: FormulaError;
}

export const BUILTIN_FUNCTIONS = new Set([
  'abs',
  'ceil',
  'floor',
  'round',
  'sign',
  'sqrt',
  'exp',
  'ln',
  'log',
  'log10',
  'pow',
  'min',
  'max',
  'clamp',
  'lerp',
  'isNaN',
  'if',
]);

export interface DependencyGraph {
  /** nodeId -> ids of variable nodes that this node's formula references */
  dependencies: Map<NodeId, NodeId[]>;
  /** nodeId -> unresolved identifiers / calls */
  unresolved: Map<NodeId, string[]>;
  parsed: Map<NodeId, ParsedFormula>;
  /** name (lowercased) -> variable node id */
  byName: Map<string, NodeId>;
}

export function resolveFormulaName(
  name: string,
  variables: VariableNode[],
): VariableNode | undefined {
  const exact = variables.find((node) => node.name === name);
  if (exact) return exact;
  const lower = name.toLocaleLowerCase();
  return variables.find((node) => node.name.toLocaleLowerCase() === lower);
}

export function buildDependencyGraph(project: Project): DependencyGraph {
  const dependencies = new Map<NodeId, NodeId[]>();
  const unresolved = new Map<NodeId, string[]>();
  const parsed = new Map<NodeId, ParsedFormula>();
  const variables = Object.values(project.nodes).filter(
    (node): node is VariableNode => node.kind === 'variable',
  );
  const byName = new Map<string, NodeId>();
  for (const node of variables) byName.set(node.name.toLocaleLowerCase(), node.id);

  for (const node of variables) {
    if (node.variableKind !== 'formula' || !node.formula || node.formula.trim() === '') {
      dependencies.set(node.id, []);
      continue;
    }

    let ast: Expr;
    try {
      ast = parseFormula(node.formula);
    } catch (error) {
      const formulaError =
        error instanceof FormulaError
          ? error
          : new FormulaError(String(error), 0, 'PARSE_ERROR');
      parsed.set(node.id, { text: node.formula, error: formulaError });
      dependencies.set(node.id, []);
      continue;
    }

    parsed.set(node.id, { text: node.formula, ast });
    const names = new Set<string>();
    for (const identifier of collectIdentifiers(ast)) names.add(identifier);
    for (const call of collectCalls(ast)) names.add(call);

    const deps = new Set<NodeId>();
    const missing: string[] = [];
    for (const name of names) {
      if (BUILTIN_FUNCTIONS.has(name)) continue;
      const target = resolveFormulaName(name, variables);
      if (target) {
        deps.add(target.id);
      } else {
        missing.push(name);
      }
    }
    dependencies.set(node.id, [...deps]);
    if (missing.length > 0) unresolved.set(node.id, missing);
  }

  return { dependencies, unresolved, parsed, byName };
}
