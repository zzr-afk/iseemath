import { BUILTIN_FUNCTIONS } from '@/core/graph/dependency';
import type { Expr } from './ast';
import { parseFormula } from './parser';

export interface RenameFormulaOptions {
  /**
   * Names that are already bound for the whole expression. Data-table fields
   * use this: a field name shadows a global variable of the same name.
   */
  boundNames?: Iterable<string>;
}

/**
 * Rewrite free references to `oldName` into `newName`, leaving local `let`
 * bindings (and anything they shadow) untouched.
 *
 * Returns `null` when the formula cannot be parsed. Callers should keep the
 * original text in that case rather than guessing at a token-level rewrite.
 */
export function renameFreeIdentifiers(
  formula: string,
  oldName: string,
  newName: string,
  options: RenameFormulaOptions = {},
): string | null {
  let ast: Expr;
  try {
    ast = parseFormula(formula);
  } catch {
    return null;
  }

  const oldLower = oldName.toLocaleLowerCase();
  const edits: { start: number; end: number; insert: string }[] = [];
  const initialBound = new Set<string>();
  for (const name of options.boundNames ?? []) {
    initialBound.add(name.toLocaleLowerCase());
  }

  const visit = (expr: Expr, bound: Set<string>): void => {
    switch (expr.type) {
      case 'identifier': {
        const lower = expr.name.toLocaleLowerCase();
        if (lower === oldLower && !bound.has(lower)) {
          edits.push({ start: expr.span.start, end: expr.span.end, insert: newName });
        }
        break;
      }
      case 'unary':
        visit(expr.operand, bound);
        break;
      case 'binary':
        visit(expr.left, bound);
        visit(expr.right, bound);
        break;
      case 'ternary':
        visit(expr.test, bound);
        visit(expr.consequent, bound);
        visit(expr.alternate, bound);
        break;
      case 'let': {
        // The initializer only sees earlier bindings; the body also sees this
        // one, which is exactly the shadowing rule used by the evaluator.
        visit(expr.value, bound);
        const next = new Set(bound);
        next.add(expr.name.toLocaleLowerCase());
        visit(expr.body, next);
        break;
      }
      case 'call': {
        const lower = expr.callee.toLocaleLowerCase();
        if (
          lower === oldLower &&
          !bound.has(lower) &&
          !BUILTIN_FUNCTIONS.has(expr.callee)
        ) {
          // The call node starts at the callee token.
          edits.push({
            start: expr.span.start,
            end: expr.span.start + expr.callee.length,
            insert: newName,
          });
        }
        for (const arg of expr.args) visit(arg, bound);
        break;
      }
      default:
        break;
    }
  };

  visit(ast, initialBound);
  if (edits.length === 0) return formula;

  edits.sort((a, b) => b.start - a.start);
  let result = formula;
  for (const edit of edits) {
    result = result.slice(0, edit.start) + edit.insert + result.slice(edit.end);
  }
  return result;
}
