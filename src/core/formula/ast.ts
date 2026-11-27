export interface Span {
  start: number;
  end: number;
}

export type Expr =
  | { type: 'number'; value: number; span: Span }
  | { type: 'string'; value: string; span: Span }
  | { type: 'boolean'; value: boolean; span: Span }
  | { type: 'identifier'; name: string; span: Span }
  | { type: 'unary'; op: '-' | '+'; operand: Expr; span: Span }
  | {
      type: 'binary';
      op: '+' | '-' | '*' | '/' | '%' | '^' | '<' | '<=' | '>' | '>=' | '==' | '!=' | 'and' | 'or';
      left: Expr;
      right: Expr;
      span: Span;
    }
  | { type: 'ternary'; test: Expr; consequent: Expr; alternate: Expr; span: Span }
  | { type: 'let'; name: string; value: Expr; body: Expr; span: Span }
  | { type: 'call'; callee: string; args: Expr[]; span: Span };

export class FormulaError extends Error {
  readonly position: number;
  readonly code: string;

  constructor(message: string, position: number, code = 'PARSE_ERROR') {
    super(message);
    this.name = 'FormulaError';
    this.position = position;
    this.code = code;
  }
}

export function collectIdentifiers(
  expr: Expr,
  out = new Set<string>(),
  bound = new Set<string>(),
): Set<string> {
  switch (expr.type) {
    case 'identifier':
      if (!bound.has(expr.name.toLocaleLowerCase())) out.add(expr.name);
      break;
    case 'unary':
      collectIdentifiers(expr.operand, out, bound);
      break;
    case 'binary':
      collectIdentifiers(expr.left, out, bound);
      collectIdentifiers(expr.right, out, bound);
      break;
    case 'ternary':
      collectIdentifiers(expr.test, out, bound);
      collectIdentifiers(expr.consequent, out, bound);
      collectIdentifiers(expr.alternate, out, bound);
      break;
    case 'let': {
      // The initializer sees only earlier locals; the body additionally sees
      // this binding, which shadows any global with the same name.
      collectIdentifiers(expr.value, out, bound);
      const next = new Set(bound);
      next.add(expr.name.toLocaleLowerCase());
      collectIdentifiers(expr.body, out, next);
      break;
    }
    case 'call':
      out.add(expr.callee);
      for (const arg of expr.args) collectIdentifiers(arg, out, bound);
      break;
    default:
      break;
  }
  return out;
}

export function collectCalls(expr: Expr, out = new Set<string>()): Set<string> {
  switch (expr.type) {
    case 'unary':
      collectCalls(expr.operand, out);
      break;
    case 'binary':
      collectCalls(expr.left, out);
      collectCalls(expr.right, out);
      break;
    case 'ternary':
      collectCalls(expr.test, out);
      collectCalls(expr.consequent, out);
      collectCalls(expr.alternate, out);
      break;
    case 'let':
      collectCalls(expr.value, out);
      collectCalls(expr.body, out);
      break;
    case 'call':
      out.add(expr.callee);
      for (const arg of expr.args) collectCalls(arg, out);
      break;
    default:
      break;
  }
  return out;
}
