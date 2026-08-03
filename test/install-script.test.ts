import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';

const repoRoot = join(import.meta.dir, '..');

describe('package.json', () => {
  const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf-8'));

  it('is named after the cairn brand', () => {
    expect(pkg.name).toBe('cairn');
  });

  it('builds to dist/cairn', () => {
    expect(pkg.scripts.build).toContain('--outfile dist/cairn');
    expect(pkg.scripts.build).not.toContain('dist/ralph');
  });
});

describe('install.sh', () => {
  const script = readFileSync(join(repoRoot, 'install.sh'), 'utf-8');

  it('builds the dist/cairn binary', () => {
    expect(script).toContain('dist/cairn');
  });

  it('symlinks both cairn and ralph to the built binary', () => {
    expect(script).toMatch(/ln -sf "\$CAIRN_BIN" "\$PREFIX\/bin\/cairn"/);
    expect(script).toMatch(/ln -sf "\$CAIRN_BIN" "\$PREFIX\/bin\/ralph"/);
  });

  it('uses CAIRN_ROOT/CAIRN_BIN local shell vars, not RALPH_ROOT/RALPH_BIN', () => {
    expect(script).toContain('CAIRN_ROOT');
    expect(script).toContain('CAIRN_BIN');
    expect(script).not.toContain('RALPH_ROOT');
    expect(script).not.toContain('RALPH_BIN');
  });

  it('does not print a deprecation warning for the ralph symlink', () => {
    expect(script.toLowerCase()).not.toContain('deprecat');
  });
});
