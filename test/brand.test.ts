import { describe, it, expect } from 'bun:test';
import { BRAND, LEGACY, warnLegacyOnce, resetLegacyWarnings } from '../src/brand';

// These assertions deliberately use literal strings instead of deriving them
// from BRAND: the point is to pin the output contract, so a wrong value in
// brand.ts fails here rather than silently propagating everywhere.
describe('BRAND', () => {
  it('exposes the canonical brand identifiers', () => {
    expect(BRAND.name).toBe('cairn');
    expect(BRAND.displayName).toBe('Cairn');
    expect(BRAND.dataDir).toBe('.cairn');
    expect(BRAND.configFile).toBe('cairn.json');
    expect(BRAND.envPrefix).toBe('CAIRN_');
    expect(BRAND.tempPrefix).toBe('.cairn_');
    expect(BRAND.socket).toBe('/tmp/cairn-tts.sock');
  });

  it('is frozen', () => {
    expect(Object.isFrozen(BRAND)).toBe(true);
    expect(() => {
      (BRAND as unknown as Record<string, string>).name = 'nope';
    }).toThrow();
    expect(BRAND.name).toBe('cairn');
  });
});

describe('LEGACY', () => {
  it('exposes the pre-rename identifiers still supported for reading', () => {
    expect(LEGACY.name).toBe('ralph');
    expect(LEGACY.dataDir).toBe('.ralph');
    expect(LEGACY.configFile).toBe('ralph.json');
  });

  it('is frozen', () => {
    expect(Object.isFrozen(LEGACY)).toBe(true);
  });
});

describe('warnLegacyOnce', () => {
  it('emits once per key and reports whether it emitted', () => {
    resetLegacyWarnings();
    const seen: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => { seen.push(args.join(' ')); };
    try {
      expect(warnLegacyOnce('a', 'first message')).toBe(true);
      expect(warnLegacyOnce('a', 'first message')).toBe(false);
      expect(warnLegacyOnce('a', 'different text same key')).toBe(false);
      expect(warnLegacyOnce('b', 'second message')).toBe(true);
    } finally {
      console.error = original;
      resetLegacyWarnings();
    }
    expect(seen.length).toBe(2);
    expect(seen[0]).toContain('first message');
    expect(seen[1]).toContain('second message');
  });

  it('re-arms after resetLegacyWarnings', () => {
    resetLegacyWarnings();
    const original = console.error;
    console.error = () => {};
    try {
      expect(warnLegacyOnce('c', 'msg')).toBe(true);
      expect(warnLegacyOnce('c', 'msg')).toBe(false);
      resetLegacyWarnings();
      expect(warnLegacyOnce('c', 'msg')).toBe(true);
    } finally {
      console.error = original;
      resetLegacyWarnings();
    }
  });
});
