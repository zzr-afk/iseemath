import { describe, expect, it } from 'vitest';
import { renameFreeIdentifiers } from './rename';

describe('renameFreeIdentifiers', () => {
  it('rewrites a global reference', () => {
    expect(renameFreeIdentifiers('攻击力 * 2 + 倍率', '攻击力', '基础攻击力')).toBe(
      '基础攻击力 * 2 + 倍率',
    );
  });

  it('keeps local bindings and their references untouched', () => {
    expect(renameFreeIdentifiers('let 攻击力 = 1; 攻击力 + 2', '攻击力', '基础攻击力')).toBe(
      'let 攻击力 = 1; 攻击力 + 2',
    );
  });

  it('still rewrites the initializer before a shadowing binding', () => {
    expect(
      renameFreeIdentifiers('let 攻击力 = 攻击力 + 1; 攻击力', '攻击力', '基础攻击力'),
    ).toBe('let 攻击力 = 基础攻击力 + 1; 攻击力');
  });

  it('rewrites curve/table calls but not builtin functions', () => {
    expect(renameFreeIdentifiers('曲线(等级) + min(1, 2)', '曲线', '成长曲线')).toBe(
      '成长曲线(等级) + min(1, 2)',
    );
    expect(renameFreeIdentifiers('min(1, 2)', 'min', '最大值')).toBe('min(1, 2)');
  });

  it('treats data-table field names as bound', () => {
    expect(
      renameFreeIdentifiers('HP + 攻击力', '攻击力', '基础攻击力', {
        boundNames: ['攻击力'],
      }),
    ).toBe('HP + 攻击力');
  });

  it('matches names case-insensitively and rewrites every occurrence', () => {
    expect(renameFreeIdentifiers('atk + ATK', 'Atk', '攻击力')).toBe('攻击力 + 攻击力');
  });

  it('returns null for formulas that cannot be parsed', () => {
    expect(renameFreeIdentifiers('攻击力 +', '攻击力', '基础攻击力')).toBeNull();
  });
});
