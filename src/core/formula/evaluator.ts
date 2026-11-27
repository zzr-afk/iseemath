import { FormulaError, type Expr } from './ast';

export type Value = number | boolean | string;

export interface EvalContext {
  getVariable: (name: string) => number | undefined;
  callUser?: (name: string, args: Value[]) => number;
  maxSteps?: number;
}

function expectNumber(value: Value, position: number, what: string): number {
  if (typeof value !== 'number') {
    throw new FormulaError(`${what}必须是数值`, position);
  }
  if (!Number.isFinite(value)) {
    throw new FormulaError(`${what}不是有限数值`, position);
  }
  return value;
}

function expectBoolean(value: Value, position: number, what: string): boolean {
  if (typeof value !== 'boolean') {
    throw new FormulaError(`${what}必须是布尔值`, position);
  }
  return value;
}

function numericFunction(
  name: string,
  args: Value[],
  position: number,
  arity: number | [number, number],
  fn: (values: number[]) => number,
): number {
  const [min, max] = typeof arity === 'number' ? [arity, arity] : arity;
  if (args.length < min || args.length > max) {
    throw new FormulaError(
      `函数 ${name} 需要 ${min === max ? min : `${min}~${max}`} 个参数`,
      position,
    );
  }
  const numbers = args.map((arg, index) =>
    expectNumber(arg, position, `函数 ${name} 的第 ${index + 1} 个参数`),
  );
  const result = fn(numbers);
  if (!Number.isFinite(result)) {
    throw new FormulaError(`函数 ${name} 的计算结果不是有限数值`, position, 'DOMAIN_ERROR');
  }
  return result;
}

export function evaluate(expr: Expr, context: EvalContext): Value {
  let steps = 0;
  const maxSteps = context.maxSteps ?? 200_000;
  const localScopes: Map<string, Value>[] = [];

  function lookupLocal(name: string): Value | undefined {
    const key = name.toLocaleLowerCase();
    for (let index = localScopes.length - 1; index >= 0; index -= 1) {
      const scope = localScopes[index]!;
      if (scope.has(key)) return scope.get(key);
    }
    return undefined;
  }

  function tick(position: number): void {
    steps += 1;
    if (steps > maxSteps) {
      throw new FormulaError('求值步数超出上限', position, 'STEP_LIMIT');
    }
  }

  function evaluateNode(node: Expr): Value {
    tick(node.span.start);

    switch (node.type) {
      case 'number':
        return node.value;
      case 'string':
        return node.value;
      case 'boolean':
        return node.value;
      case 'identifier': {
        const local = lookupLocal(node.name);
        if (local !== undefined) return local;
        const value = context.getVariable(node.name);
        if (value === undefined) {
          throw new FormulaError(`未知变量：${node.name}`, node.span.start, 'UNKNOWN_IDENTIFIER');
        }
        if (!Number.isFinite(value)) {
          throw new FormulaError(`变量 ${node.name} 不是有限数值`, node.span.start);
        }
        return value;
      }
      case 'let': {
        const value = evaluateNode(node.value);
        const scope = new Map<string, Value>([[node.name.toLocaleLowerCase(), value]]);
        localScopes.push(scope);
        try {
          return evaluateNode(node.body);
        } finally {
          localScopes.pop();
        }
      }
      case 'unary': {
        const operand = expectNumber(evaluateNode(node.operand), node.span.start, '一元运算的操作数');
        return node.op === '-' ? -operand : operand;
      }
      case 'ternary': {
        const test = expectBoolean(evaluateNode(node.test), node.test.span.start, '条件表达式');
        return test ? evaluateNode(node.consequent) : evaluateNode(node.alternate);
      }
      case 'binary': {
        if (node.op === 'and') {
          const left = expectBoolean(evaluateNode(node.left), node.left.span.start, 'and 左侧');
          return left ? expectBoolean(evaluateNode(node.right), node.right.span.start, 'and 右侧') : false;
        }
        if (node.op === 'or') {
          const left = expectBoolean(evaluateNode(node.left), node.left.span.start, 'or 左侧');
          return left ? true : expectBoolean(evaluateNode(node.right), node.right.span.start, 'or 右侧');
        }

        const left = evaluateNode(node.left);
        const right = evaluateNode(node.right);

        switch (node.op) {
          case '+':
            return expectNumber(left, node.span.start, '+ 左侧') + expectNumber(right, node.span.start, '+ 右侧');
          case '-':
            return expectNumber(left, node.span.start, '- 左侧') - expectNumber(right, node.span.start, '- 右侧');
          case '*':
            return expectNumber(left, node.span.start, '* 左侧') * expectNumber(right, node.span.start, '* 右侧');
          case '/': {
            const divisor = expectNumber(right, node.span.start, '除数');
            if (divisor === 0) throw new FormulaError('除零', node.span.start, 'DIVIDE_BY_ZERO');
            return expectNumber(left, node.span.start, '被除数') / divisor;
          }
          case '%': {
            const divisor = expectNumber(right, node.span.start, '除数');
            if (divisor === 0) throw new FormulaError('取余除零', node.span.start, 'DIVIDE_BY_ZERO');
            return expectNumber(left, node.span.start, '被除数') % divisor;
          }
          case '^': {
            const base = expectNumber(left, node.span.start, '底数');
            const exponent = expectNumber(right, node.span.start, '指数');
            if (base === 0 && exponent < 0) {
              throw new FormulaError('0 的负次幂', node.span.start, 'DOMAIN_ERROR');
            }
            const result = base ** exponent;
            if (!Number.isFinite(result)) {
              throw new FormulaError('幂运算结果不是有限数值', node.span.start, 'DOMAIN_ERROR');
            }
            return result;
          }
          case '<':
          case '<=':
          case '>':
          case '>=': {
            const a = expectNumber(left, node.left.span.start, '比较左侧');
            const b = expectNumber(right, node.right.span.start, '比较右侧');
            if (node.op === '<') return a < b;
            if (node.op === '<=') return a <= b;
            if (node.op === '>') return a > b;
            return a >= b;
          }
          case '==':
            return left === right;
          case '!=':
            return left !== right;
          default:
            throw new FormulaError('未知运算符', node.span.start);
        }
      }
      case 'call':
        return evaluateCall(node);
    }
  }

  function evaluateCall(node: Extract<Expr, { type: 'call' }>): Value {
    if (node.callee === 'if') {
      if (node.args.length !== 3) {
        throw new FormulaError('if 需要 3 个参数', node.span.start);
      }
      const test = expectBoolean(evaluateNode(node.args[0]!), node.args[0]!.span.start, 'if 条件');
      return test ? evaluateNode(node.args[1]!) : evaluateNode(node.args[2]!);
    }

    const args = node.args.map(evaluateNode);
    const position = node.span.start;

    switch (node.callee) {
      case 'abs':
        return numericFunction('abs', args, position, 1, (values) => Math.abs(values[0]!));
      case 'ceil':
        return numericFunction('ceil', args, position, 1, (values) => Math.ceil(values[0]!));
      case 'floor':
        return numericFunction('floor', args, position, 1, (values) => Math.floor(values[0]!));
      case 'round':
        return numericFunction('round', args, position, 1, (values) => {
          const value = values[0]!;
          return Math.sign(value) * Math.floor(Math.abs(value) + 0.5);
        });
      case 'sign':
        return numericFunction('sign', args, position, 1, (values) => Math.sign(values[0]!));
      case 'sqrt':
        return numericFunction('sqrt', args, position, 1, (values) => Math.sqrt(values[0]!));
      case 'exp':
        return numericFunction('exp', args, position, 1, (values) => Math.exp(values[0]!));
      case 'ln':
        return numericFunction('ln', args, position, 1, (values) => Math.log(values[0]!));
      case 'log10':
        return numericFunction('log10', args, position, 1, (values) => Math.log10(values[0]!));
      case 'log':
        return numericFunction('log', args, position, [1, 2], (values) =>
          values.length === 1
            ? Math.log10(values[0]!)
            : Math.log(values[0]!) / Math.log(values[1]!),
        );
      case 'pow':
        return numericFunction('pow', args, position, 2, (values) => values[0]! ** values[1]!);
      case 'min':
        if (args.length < 1) throw new FormulaError('min 至少需要 1 个参数', position);
        return Math.min(...args.map((arg) => expectNumber(arg, position, 'min 参数')));
      case 'max':
        if (args.length < 1) throw new FormulaError('max 至少需要 1 个参数', position);
        return Math.max(...args.map((arg) => expectNumber(arg, position, 'max 参数')));
      case 'clamp':
        return numericFunction('clamp', args, position, 3, (values) => {
          const [value, low, high] = values as [number, number, number];
          if (low > high) throw new FormulaError('clamp 的下界大于上界', position);
          return Math.min(Math.max(value, low), high);
        });
      case 'lerp':
        return numericFunction('lerp', args, position, 3, (values) => {
          const [a, b, t] = values as [number, number, number];
          return a + (b - a) * t;
        });
      case 'isNaN':
        if (args.length !== 1) throw new FormulaError('isNaN 需要 1 个参数', position);
        return typeof args[0] === 'number' ? Number.isNaN(args[0]) : true;
      default: {
        if (context.callUser) {
          return context.callUser(node.callee, args);
        }
        throw new FormulaError(`未知函数：${node.callee}`, position, 'UNKNOWN_FUNCTION');
      }
    }
  }

  return evaluateNode(expr);
}

export function evaluateNumber(expr: Expr, context: EvalContext): number {
  const value = evaluate(expr, context);
  if (typeof value !== 'number') {
    throw new FormulaError('表达式结果必须是数值', expr.span.start);
  }
  return value;
}
