import { describe, expect, it } from 'vitest';
import { parseFormula } from './parser';
import { evaluate } from './evaluator';

function compute(source: string, variables: Record<string, number> = {}): number {
  const ast = parseFormula(source);
  const value = evaluate(ast, {
    getVariable: (name) => variables[name],
  });
  if (typeof value !== 'number') throw new Error('expected number');
  return value;
}

describe('formula precedence', () => {
  it('binds ^ tighter than unary minus', () => {
    expect(compute('-2^2')).toBe(-4);
    expect(compute('-(2^3)')).toBe(-8);
  });

  it('allows unary exponent and right-associates ^', () => {
    expect(compute('2^-3')).toBe(0.125);
    expect(compute('2^3^2')).toBe(512);
  });

  it('keeps remainder sign with the dividend', () => {
    expect(compute('-5 % 3')).toBe(-2);
  });

  it('handles arithmetic precedence and parentheses', () => {
    expect(compute('1 + 2 * 3')).toBe(7);
    expect(compute('(1 + 2) * 3')).toBe(9);
  });

  it('rejects chained comparisons', () => {
    expect(() => parseFormula('1 < 2 < 3')).toThrow();
  });

  it('evaluates ternary and logic lazily', () => {
    expect(compute('1 < 2 ? 10 : 20')).toBe(10);
    expect(compute('true ? 1 : 1 / 0')).toBe(1);
    expect(compute('false and 1 / 0 > 1 ? 1 : 2')).toBe(2);
  });

  it('supports Chinese identifiers', () => {
    expect(compute('攻击力 * 技能倍率 - 防御力', { 攻击力: 100, 技能倍率: 2, 防御力: 20 })).toBe(180);
  });

  it('rejects division by zero as an error', () => {
    expect(() => compute('1 / 0')).toThrow();
  });
});

describe('local bindings', () => {
  it('supports let bindings and reuse', () => {
    expect(compute('let a = 2; let b = a * 3; a + b')).toBe(8);
  });

  it('allows omitting let', () => {
    expect(compute('a = 2; b = a + 1; a * b')).toBe(6);
  });

  it('lets a local shadow a global name', () => {
    expect(compute('let a = 2; a + 1', { a: 100 })).toBe(3);
  });

  it('resolves outer locals inside later bindings', () => {
    expect(compute('let a = 攻击力 * 2; let b = a + 1; b', { 攻击力: 10 })).toBe(21);
  });

  it('allows boolean locals for conditions', () => {
    expect(compute('let ok = 2 > 1; ok ? 10 : 20')).toBe(10);
  });

  it('rejects duplicate local names', () => {
    expect(() => parseFormula('let a = 1; let a = 2; a')).toThrow('重复定义');
  });

  it('rejects reserved local names', () => {
    expect(() => parseFormula('let PI = 3; PI')).toThrow('保留名');
  });

  it('requires a semicolon after each binding', () => {
    expect(() => parseFormula('let a = 1 let b = 2; a + b')).toThrow();
  });
});
