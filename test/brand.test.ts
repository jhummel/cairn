import { describe, it, expect } from 'bun:test';
import * as brand from '../src/brand';
import { BRAND, NOTES_TEMP_PREFIX } from '../src/brand';

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
    expect(Object.keys(BRAND).sort()).toEqual(
      ['configFile', 'dataDir', 'displayName', 'envPrefix', 'name', 'tempPrefix'],
    );
  });

  it('is frozen', () => {
    expect(Object.isFrozen(BRAND)).toBe(true);
    expect(() => {
      (BRAND as unknown as Record<string, string>).name = 'nope';
    }).toThrow();
    expect(BRAND.name).toBe('cairn');
  });
});

describe('NOTES_TEMP_PREFIX', () => {
  // A permanent exception, not a compatibility fallback: per-task notes scratch
  // files keep their pre-rename name forever. Pinned as a literal so a "tidy-up"
  // that points it at BRAND.tempPrefix fails here instead of silently orphaning
  // every already-committed .gitignore line.
  it('pins the permanent scratch-file prefix', () => {
    expect(NOTES_TEMP_PREFIX).toBe('.ralph_');
  });

  it('is deliberately distinct from BRAND.tempPrefix', () => {
    expect(NOTES_TEMP_PREFIX).not.toBe(BRAND.tempPrefix);
  });
});

describe('legacy surface', () => {
  it('no longer exports LEGACY or the one-time warning helpers', () => {
    const exported = brand as unknown as Record<string, unknown>;
    expect(exported.LEGACY).toBeUndefined();
    expect(exported.warnLegacyOnce).toBeUndefined();
    expect(exported.resetLegacyWarnings).toBeUndefined();
  });
});
