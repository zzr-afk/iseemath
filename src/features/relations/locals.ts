import type { Expr } from '@/core/formula/ast';
import { evaluate, type Value } from '@/core/formula/evaluator';
import { tokenize } from '@/core/formula/lexer';
import { parseFormula } from '@/core/formula/parser';

export interface LocalBinding {
  name: string;
  expression: string;
}

export interface LocalProgram {
  bindings: LocalBinding[];
  result: string;
}

const LOCAL_NAME_PATTERN = /^[\p{L}_][\p{L}\p{N}_]*$/u;
const RESERVED_LOCAL_NAMES = new Set(['let', 'true', 'false', 'and', 'or', 'pi', 'e']);

/**
 * Split a stored formula back into its top-level `let` chain:
 *
 *   let a = 1; let b = a + 2; a * b
 *   -> { bindings: [{a, "1"}, {b, "a + 2"}], result: "a * b" }
 *
 * Returns `null` when the text does not parse, so the caller can keep showing
 * the raw formula instead of guessing at a structure.
 */
export function parseLocalProgram(source: string): LocalProgram | null {
  const text = source ?? '';
  if (text.trim() === '') return { bindings: [], result: '' };

  let ast: Expr;
  try {
    ast = parseFormula(text);
  } catch {
    return null;
  }

  const names: string[] = [];
  let cursor: Expr = ast;
  while (cursor.type === 'let') {
    names.push(cursor.name);
    cursor = cursor.body;
  }

  // AST spans stop at the inner expression of a parenthesized group, so split
  // the source text at the binding terminators instead. Semicolons cannot
  // appear inside an expression, so every `;` token ends exactly one binding.
  const tokens = tokenize(text);
  const segments: { start: number; end: number }[] = [];
  let segmentStart = 0;
  let lastSemicolonEnd = 0;
  for (const token of tokens) {
    if (token.type === 'operator' && token.value === ';') {
      segments.push({ start: segmentStart, end: token.start });
      segmentStart = token.end;
      lastSemicolonEnd = token.end;
    }
  }
  if (segments.length !== names.length) return null;

  const bindings = names.map((name, index) => {
    const segment = segments[index]!;
    const equals = tokens.find(
      (token) =>
        token.type === 'operator' &&
        token.value === '=' &&
        token.start >= segment.start &&
        token.end <= segment.end,
    );
    if (!equals) return { name, expression: '' };
    return { name, expression: text.slice(equals.end, segment.end).trim() };
  });

  return {
    bindings,
    result: text.slice(lastSemicolonEnd).trim(),
  };
}

/** Serialize local definitions back into the canonical `let ...;` syntax. */
export function buildLocalProgram(program: LocalProgram): string {
  const parts = program.bindings.map(
    (binding) => `let ${binding.name.trim()} = ${binding.expression.trim()};`,
  );
  const result = program.result.trim();
  if (result) parts.push(result);
  return parts.join(' ').trim();
}

function isReserved(name: string): boolean {
  return RESERVED_LOCAL_NAMES.has(name.toLocaleLowerCase());
}

export function validateLocalName(name: string, others: readonly string[]): string | null {
  const trimmed = name.trim();
  if (!trimmed) return '局部量名字不能为空';
  if (!LOCAL_NAME_PATTERN.test(trimmed)) {
    return '局部量名字只能用字母、中文、数字、下划线，且不能以数字开头';
  }
  if (isReserved(trimmed)) return `「${trimmed}」是保留名，不能作为局部量`;
  const lower = trimmed.toLocaleLowerCase();
  if (others.some((other) => other.trim().toLocaleLowerCase() === lower)) {
    return `局部量「${trimmed}」已存在`;
  }
  return null;
}

/** a, b, c ... z, then a2, b2 ... — skipping reserved names and used names. */
export function nextLocalName(existing: readonly string[]): string {
  const used = new Set(existing.map((name) => name.trim().toLocaleLowerCase()));
  const alphabet = 'abcdefghijklmnopqrstuvwxyz';
  for (let round = 1; ; round += 1) {
    for (const letter of alphabet) {
      const candidate = round === 1 ? letter : `${letter}${round}`;
      if (!isReserved(candidate) && !used.has(candidate)) return candidate;
    }
  }
}

function renameIdentifier(text: string, oldName: string, newName: string): string {
  let ast: Expr;
  try {
    ast = parseFormula(text);
  } catch {
    return text;
  }

  const oldLower = oldName.toLocaleLowerCase();
  const edits: { start: number; end: number }[] = [];

  const visit = (expr: Expr): void => {
    switch (expr.type) {
      case 'identifier':
        if (expr.name.toLocaleLowerCase() === oldLower) {
          edits.push({ start: expr.span.start, end: expr.span.end });
        }
        break;
      case 'unary':
        visit(expr.operand);
        break;
      case 'binary':
        visit(expr.left);
        visit(expr.right);
        break;
      case 'ternary':
        visit(expr.test);
        visit(expr.consequent);
        visit(expr.alternate);
        break;
      case 'let':
        visit(expr.value);
        visit(expr.body);
        break;
      case 'call':
        // The callee is a function name, never a local value.
        for (const arg of expr.args) visit(arg);
        break;
      default:
        break;
    }
  };

  visit(ast);
  if (edits.length === 0) return text;

  edits.sort((left, right) => right.start - left.start);
  let result = text;
  for (const edit of edits) {
    result = result.slice(0, edit.start) + newName + result.slice(edit.end);
  }
  return result;
}

/**
 * Rename one local binding and rewrite references in the bindings *after* it
 * and in the result expression. Earlier bindings cannot see this one, and the
 * renamed binding's own initializer refers to the outer scope, so neither is
 * touched.
 */
export function renameLocalBinding(
  bindings: readonly LocalBinding[],
  result: string,
  index: number,
  newName: string,
): { bindings: LocalBinding[]; result: string } {
  const target = bindings[index];
  if (!target) return { bindings: [...bindings], result };
  const oldName = target.name;
  if (!oldName.trim() || oldName === newName) return { bindings: [...bindings], result };

  return {
    bindings: bindings.map((binding, position) => {
      if (position === index) return { name: newName, expression: binding.expression };
      if (position > index) {
        return {
          ...binding,
          expression: renameIdentifier(binding.expression, oldName, newName),
        };
      }
      return binding;
    }),
    result: renameIdentifier(result, oldName, newName),
  };
}

/**
 * Best-effort values for the local definitions, so the row can show
 * `a = 300` without waiting for a full project evaluation. Each binding is
 * evaluated with the earlier locals in scope; failures become `undefined`.
 */
export function evaluateLocalValues(
  bindings: readonly LocalBinding[],
  globals: Map<string, number>,
): (Value | undefined)[] {
  const values: (Value | undefined)[] = [];
  for (let index = 0; index < bindings.length; index += 1) {
    const prefix = bindings
      .slice(0, index + 1)
      .map((binding) => `let ${binding.name} = ${binding.expression};`)
      .join(' ');
    const source = `${prefix} ${bindings[index]!.name}`;
    try {
      const ast = parseFormula(source);
      values.push(
        evaluate(ast, {
          getVariable: (name) => globals.get(name.toLocaleLowerCase()),
        }),
      );
    } catch {
      values.push(undefined);
    }
  }
  return values;
}
