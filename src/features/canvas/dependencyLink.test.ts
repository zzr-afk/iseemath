import { describe, expect, it } from 'vitest';
import { appendDependencyFormula } from './dependencyLink';

describe('appendDependencyFormula', () => {
  it('uses the source as the whole formula when empty', () => {
    expect(appendDependencyFormula('', '攻击力')).toBe('攻击力');
    expect(appendDependencyFormula(undefined, '攻击力')).toBe('攻击力');
  });

  it('replaces the default zero placeholder', () => {
    expect(appendDependencyFormula('0', '攻击力')).toBe('攻击力');
    expect(appendDependencyFormula(' 0 ', '攻击力')).toBe('攻击力');
  });

  it('appends a dependency to an existing formula', () => {
    expect(appendDependencyFormula('攻击力 * 倍率', '暴击率')).toBe('攻击力 * 倍率 + 暴击率');
  });

  it('appends after local bindings and the result expression', () => {
    expect(appendDependencyFormula('let a = 1; a * 2', '倍率')).toBe(
      'let a = 1; a * 2 + 倍率',
    );
  });
});
