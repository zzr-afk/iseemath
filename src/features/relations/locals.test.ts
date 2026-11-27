import { describe, expect, it } from 'vitest';
import {
  buildLocalProgram,
  evaluateLocalValues,
  nextLocalName,
  parseLocalProgram,
  renameLocalBinding,
  validateLocalName,
} from './locals';

describe('parseLocalProgram', () => {
  it('reads a plain expression as an empty local scope', () => {
    expect(parseLocalProgram('攻击力 * 2 + 100')).toEqual({
      bindings: [],
      result: '攻击力 * 2 + 100',
    });
  });

  it('splits a let chain into ordered bindings and a result', () => {
    expect(parseLocalProgram('let a = 基础攻击 * 2; let b = 攻击加成; (a + b) * 暴击倍率')).toEqual({
      bindings: [
        { name: 'a', expression: '基础攻击 * 2' },
        { name: 'b', expression: '攻击加成' },
      ],
      result: '(a + b) * 暴击倍率',
    });
  });

  it('accepts bindings without the let keyword', () => {
    expect(parseLocalProgram('a = 1; b = a + 2; a * b')).toEqual({
      bindings: [
        { name: 'a', expression: '1' },
        { name: 'b', expression: 'a + 2' },
      ],
      result: 'a * b',
    });
  });

  it('treats an empty formula as an empty program', () => {
    expect(parseLocalProgram('   ')).toEqual({ bindings: [], result: '' });
  });

  it('returns null for an unparsable formula', () => {
    expect(parseLocalProgram('let a = ; a')).toBeNull();
    expect(parseLocalProgram('1 +')).toBeNull();
  });
});

describe('buildLocalProgram', () => {
  it('serializes back into canonical let syntax', () => {
    expect(
      buildLocalProgram({
        bindings: [
          { name: 'a', expression: '基础攻击 * 2' },
          { name: 'b', expression: '攻击加成' },
        ],
        result: '(a + b) * 暴击倍率',
      }),
    ).toBe('let a = 基础攻击 * 2; let b = 攻击加成; (a + b) * 暴击倍率');
  });

  it('keeps a binding-free expression untouched', () => {
    expect(buildLocalProgram({ bindings: [], result: '1 + 2' })).toBe('1 + 2');
  });

  it('round-trips through parseLocalProgram', () => {
    const program = {
      bindings: [
        { name: 'a', expression: '1' },
        { name: 'b', expression: 'a + 2' },
        { name: 'c', expression: 'b * (a - 1)' },
      ],
      result: 'a + b + c',
    };
    expect(parseLocalProgram(buildLocalProgram(program))).toEqual(program);
  });
});

describe('validateLocalName', () => {
  it('accepts letters, Chinese and digits after the first character', () => {
    expect(validateLocalName('a', [])).toBeNull();
    expect(validateLocalName('基础值', [])).toBeNull();
    expect(validateLocalName('值1', [])).toBeNull();
  });

  it('rejects empty, malformed, reserved and duplicate names', () => {
    expect(validateLocalName('', [])).toBeTruthy();
    expect(validateLocalName('1a', [])).toBeTruthy();
    expect(validateLocalName('a b', [])).toBeTruthy();
    expect(validateLocalName('let', [])).toBeTruthy();
    expect(validateLocalName('PI', [])).toBeTruthy();
    expect(validateLocalName('a', ['A'])).toBeTruthy();
  });
});

describe('nextLocalName', () => {
  it('walks a, b, c and skips reserved and used names', () => {
    expect(nextLocalName([])).toBe('a');
    expect(nextLocalName(['a', 'b'])).toBe('c');
    expect(nextLocalName(['a', 'b', 'c', 'd'])).toBe('f');
    expect(nextLocalName(['A'])).toBe('b');
  });

  it('falls back to numbered names after z', () => {
    const used = 'abcdefghijklmnopqrstuvwxyz'.split('');
    expect(nextLocalName(used)).toBe('a2');
  });
});

describe('renameLocalBinding', () => {
  it('rewrites later expressions and the result, but not earlier or own initializer', () => {
    const bindings = [
      { name: 'a', expression: '基础攻击 * 2' },
      { name: 'b', expression: 'a + 2' },
      { name: 'c', expression: 'b * min(a, 3)' },
    ];
    const renamed = renameLocalBinding(bindings, 'a + b + c', 0, 'x');
    expect(renamed.bindings).toEqual([
      { name: 'x', expression: '基础攻击 * 2' },
      { name: 'b', expression: 'x + 2' },
      { name: 'c', expression: 'b * min(x, 3)' },
    ]);
    expect(renamed.result).toBe('x + b + c');
  });

  it('matches references case-insensitively', () => {
    const renamed = renameLocalBinding(
      [
        { name: 'a', expression: '1' },
        { name: 'b', expression: 'A + 2' },
      ],
      'a',
      0,
      'z',
    );
    expect(renamed.bindings[1]!.expression).toBe('z + 2');
    expect(renamed.result).toBe('z');
  });

  it('leaves the program untouched for an unknown index or identical name', () => {
    const bindings = [{ name: 'a', expression: '1' }];
    expect(renameLocalBinding(bindings, 'a', 5, 'b')).toEqual({ bindings, result: 'a' });
    expect(renameLocalBinding(bindings, 'a', 0, 'a')).toEqual({ bindings, result: 'a' });
  });
});

describe('evaluateLocalValues', () => {
  it('evaluates bindings in order with earlier locals in scope', () => {
    const values = evaluateLocalValues(
      [
        { name: 'a', expression: '基础攻击 * 2' },
        { name: 'b', expression: 'a + 100' },
        { name: 'c', expression: 'b * 0.5' },
      ],
      new Map([['基础攻击', 300]]),
    );
    expect(values).toEqual([600, 700, 350]);
  });

  it('lets a local shadow a global of the same name', () => {
    const values = evaluateLocalValues(
      [
        { name: 'x', expression: '1' },
        { name: 'y', expression: 'x + 10' },
      ],
      new Map([['x', 100]]),
    );
    expect(values).toEqual([1, 11]);
  });

  it('reports undefined for a binding that cannot be evaluated', () => {
    const values = evaluateLocalValues(
      [
        { name: 'a', expression: '1 / 0' },
        { name: 'b', expression: 'a + 1' },
      ],
      new Map(),
    );
    expect(values).toEqual([undefined, undefined]);
  });

  it('supports non-numeric local values', () => {
    const values = evaluateLocalValues(
      [{ name: 'flag', expression: '1 < 2' }],
      new Map(),
    );
    expect(values).toEqual([true]);
  });
});
