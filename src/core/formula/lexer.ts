import { FormulaError } from './ast';

export type TokenType = 'number' | 'string' | 'identifier' | 'operator' | 'eof';

export interface Token {
  type: TokenType;
  value: string;
  numericValue?: number;
  start: number;
  end: number;
}

const TWO_CHAR_OPERATORS = ['<=', '>=', '==', '!='];
const ONE_CHAR_OPERATORS = ['+', '-', '*', '/', '%', '^', '(', ')', ',', '?', ':', '<', '>', '=', ';'];

function isIdentifierStart(char: string): boolean {
  return /[\p{L}_]/u.test(char);
}

function isIdentifierPart(char: string): boolean {
  return /[\p{L}\p{N}_]/u.test(char);
}

export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;

  while (index < source.length) {
    const char = source[index]!;

    if (/\s/.test(char)) {
      index += 1;
      continue;
    }

    if (/[0-9]/.test(char) || (char === '.' && /[0-9]/.test(source[index + 1] ?? ''))) {
      const start = index;
      let sawDot = false;
      let sawExponent = false;
      while (index < source.length) {
        const current = source[index]!;
        if (/[0-9]/.test(current)) {
          index += 1;
        } else if (current === '.' && !sawDot && !sawExponent) {
          sawDot = true;
          index += 1;
        } else if ((current === 'e' || current === 'E') && !sawExponent) {
          sawExponent = true;
          index += 1;
          const sign = source[index];
          if (sign === '+' || sign === '-') index += 1;
        } else {
          break;
        }
      }
      const raw = source.slice(start, index);
      const numericValue = Number(raw);
      if (!Number.isFinite(numericValue)) {
        throw new FormulaError(`数字格式无效：${raw}`, start);
      }
      tokens.push({ type: 'number', value: raw, numericValue, start, end: index });
      continue;
    }

    if (char === '"') {
      const start = index;
      index += 1;
      let value = '';
      let closed = false;
      while (index < source.length) {
        const current = source[index]!;
        if (current === '\\') {
          const next = source[index + 1];
          index += 2;
          switch (next) {
            case '"':
              value += '"';
              break;
            case '\\':
              value += '\\';
              break;
            case 'n':
              value += '\n';
              break;
            case 't':
              value += '\t';
              break;
            case 'u': {
              const hex = source.slice(index + 1, index + 5);
              if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
                throw new FormulaError('无效的 Unicode 转义', index - 2);
              }
              value += String.fromCharCode(Number.parseInt(hex, 16));
              index += 4;
              break;
            }
            default:
              throw new FormulaError(`未知转义：\\${next ?? ''}`, index - 2);
          }
          continue;
        }
        if (current === '"') {
          index += 1;
          closed = true;
          break;
        }
        value += current;
        index += 1;
      }
      if (!closed) throw new FormulaError('字符串缺少结束引号', start);
      tokens.push({ type: 'string', value, start, end: index });
      continue;
    }

    if (isIdentifierStart(char)) {
      const start = index;
      index += 1;
      while (index < source.length && isIdentifierPart(source[index]!)) index += 1;
      tokens.push({ type: 'identifier', value: source.slice(start, index), start, end: index });
      continue;
    }

    const two = source.slice(index, index + 2);
    if (TWO_CHAR_OPERATORS.includes(two)) {
      tokens.push({ type: 'operator', value: two, start: index, end: index + 2 });
      index += 2;
      continue;
    }

    if (ONE_CHAR_OPERATORS.includes(char)) {
      tokens.push({ type: 'operator', value: char, start: index, end: index + 1 });
      index += 1;
      continue;
    }

    throw new FormulaError(`无法识别的字符：${char}`, index);
  }

  tokens.push({ type: 'eof', value: '', start: source.length, end: source.length });
  return tokens;
}
