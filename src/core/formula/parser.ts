import { FormulaError, type Expr, type Span } from './ast';
import { tokenize, type Token } from './lexer';

const COMPARISON_OPS = new Set(['<', '<=', '>', '>=', '==', '!=']);

function isComparisonOp(op: string): boolean {
  return COMPARISON_OPS.has(op);
}

function span(start: number, end: number): Span {
  return { start, end };
}

export function parseFormula(source: string): Expr {
  const tokens = tokenize(source);
  let index = 0;

  function peek(offset = 0): Token {
    return tokens[Math.min(index + offset, tokens.length - 1)]!;
  }

  function consume(): Token {
    const token = tokens[index]!;
    index += 1;
    return token;
  }

  function expectOperator(value: string): Token {
    const token = peek();
    if (token.type !== 'operator' || token.value !== value) {
      throw new FormulaError(`期望「${value}」，实际是「${token.value || '结束'}」`, token.start);
    }
    return consume();
  }

  const RESERVED_BINDING_NAMES = new Set(['let', 'true', 'false', 'and', 'or']);

  function isBindingStart(): boolean {
    const token = peek();
    if (token.type !== 'identifier') return false;
    if (token.value === 'let') {
      const name = peek(1);
      const equals = peek(2);
      return (
        name.type === 'identifier' &&
        equals.type === 'operator' &&
        equals.value === '='
      );
    }
    const equals = peek(1);
    return equals.type === 'operator' && equals.value === '=';
  }

  /**
   * Zero or more local bindings followed by a result expression:
   *   let a = ...; b = ...; a + b
   * `let` is optional; each binding must end with a semicolon.
   */
  function parseProgram(): Expr {
    const bindings: { name: string; value: Expr; start: number }[] = [];
    const seen = new Set<string>();

    while (isBindingStart()) {
      const first = peek();
      if (first.value === 'let') consume();
      const nameToken = consume();
      const name = nameToken.value;
      const lower = name.toLocaleLowerCase();
      if (RESERVED_BINDING_NAMES.has(lower) || name === 'PI' || name === 'E') {
        throw new FormulaError(`不能使用保留名「${name}」作为局部变量`, nameToken.start);
      }
      if (seen.has(lower)) {
        throw new FormulaError(`局部变量「${name}」重复定义`, nameToken.start);
      }
      seen.add(lower);

      expectOperator('=');
      const value = parseExpression(0);
      expectOperator(';');
      bindings.push({ name, value, start: first.start });
    }

    let expression = parseExpression(0);
    for (let index = bindings.length - 1; index >= 0; index -= 1) {
      const binding = bindings[index]!;
      expression = {
        type: 'let',
        name: binding.name,
        value: binding.value,
        body: expression,
        span: span(binding.start, expression.span.end),
      };
    }
    return expression;
  }

  function parseExpression(minBindingPower: number): Expr {
    let left = parsePrefix();

    for (;;) {
      const token = peek();

      if (token.type === 'operator' && token.value === '?' && minBindingPower <= 0) {
        consume();
        const consequent = parseExpression(0);
        expectOperator(':');
        const alternate = parseExpression(0);
        left = {
          type: 'ternary',
          test: left,
          consequent,
          alternate,
          span: span(left.span.start, alternate.span.end),
        };
        continue;
      }

      let op: string | null = null;
      if (token.type === 'operator' && ['+', '-', '*', '/', '%', '^', '<', '<=', '>', '>=', '==', '!='].includes(token.value)) {
        op = token.value;
      } else if (token.type === 'identifier' && (token.value === 'and' || token.value === 'or')) {
        op = token.value;
      }
      if (op === null) break;

      const bindingPower = bindingPowerOf(op);
      if (bindingPower < minBindingPower) break;

      if (
        isComparisonOp(op) &&
        left.type === 'binary' &&
        isComparisonOp(left.op)
      ) {
        throw new FormulaError('比较运算不能链式书写，请用 and 连接', token.start);
      }

      consume();
      const rightBindingPower = op === '^' ? bindingPower : bindingPower + 1;
      const right = parseExpression(rightBindingPower);
      left = {
        type: 'binary',
        op: op as Extract<Expr, { type: 'binary' }>['op'],
        left,
        right,
        span: span(left.span.start, right.span.end),
      };
    }

    return left;
  }

  function bindingPowerOf(op: string): number {
    switch (op) {
      case 'or':
        return 1;
      case 'and':
        return 2;
      case '<':
      case '<=':
      case '>':
      case '>=':
      case '==':
      case '!=':
        return 3;
      case '+':
      case '-':
        return 4;
      case '*':
      case '/':
      case '%':
        return 5;
      case '^':
        return 7;
      default:
        return -1;
    }
  }

  function parsePrefix(): Expr {
    const token = peek();

    if (token.type === 'number') {
      consume();
      return {
        type: 'number',
        value: token.numericValue ?? 0,
        span: span(token.start, token.end),
      };
    }

    if (token.type === 'string') {
      consume();
      return { type: 'string', value: token.value, span: span(token.start, token.end) };
    }

    if (token.type === 'operator' && (token.value === '-' || token.value === '+')) {
      consume();
      const operand = parseExpression(6);
      return {
        type: 'unary',
        op: token.value,
        operand,
        span: span(token.start, operand.span.end),
      };
    }

    if (token.type === 'operator' && token.value === '(') {
      consume();
      const inner = parseExpression(0);
      expectOperator(')');
      return inner;
    }

    if (token.type === 'identifier') {
      consume();
      if (token.value === 'true' || token.value === 'false') {
        return {
          type: 'boolean',
          value: token.value === 'true',
          span: span(token.start, token.end),
        };
      }
      if (token.value === 'PI') {
        return { type: 'number', value: Math.PI, span: span(token.start, token.end) };
      }
      if (token.value === 'E') {
        return { type: 'number', value: Math.E, span: span(token.start, token.end) };
      }

      const next = peek();
      if (next.type === 'operator' && next.value === '(') {
        consume();
        const args: Expr[] = [];
        if (!(peek().type === 'operator' && peek().value === ')')) {
          for (;;) {
            args.push(parseExpression(0));
            const separator = peek();
            if (separator.type === 'operator' && separator.value === ',') {
              consume();
              continue;
            }
            break;
          }
        }
        const close = expectOperator(')');
        return {
          type: 'call',
          callee: token.value,
          args,
          span: span(token.start, close.end),
        };
      }

      return { type: 'identifier', name: token.value, span: span(token.start, token.end) };
    }

    throw new FormulaError(
      token.type === 'eof' ? '表达式意外结束' : `无法解析的符号：${token.value}`,
      token.start,
    );
  }

  const expression = parseProgram();
  const trailing = peek();
  if (trailing.type !== 'eof') {
    throw new FormulaError(`表达式末尾有多余内容：${trailing.value}`, trailing.start);
  }
  return expression;
}
