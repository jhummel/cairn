import { describe, test, expect } from 'bun:test';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, resolve, relative } from 'path';

/**
 * Every surviving `ralph` reference in shipped source must be an INTENTIONAL
 * compatibility fallback, and every such fallback must be findable by grep so
 * the eventual removal round is mechanical rather than archaeological.
 *
 * The contract: a source line mentioning the legacy name must have
 * `remove once all projects migrated` within a few lines of it. Anything else
 * is a rename miss.
 *
 * NOT scanned: `.cairn/`/`.ralph/` data dirs and `.claude/` (generated
 * per-project artifacts, not source), test files (fixtures legitimately create
 * legacy-layout projects), and docs (prose explains the compatibility window at
 * length).
 */

const REPO_ROOT = resolve(import.meta.dir, '..');
const MARKER = 'remove once all projects migrated';

/** Lines around a legacy hit that may carry the marker for it. */
const LOOKBACK = 20;
const LOOKAHEAD = 3;

/**
 * Legacy mentions that are deliberately NOT compatibility fallbacks and so
 * carry a different marker. The narration socket and pid file were never given
 * the dual-name treatment — they are plain un-migrated literals tracked by
 * task #48 and marked `TODO(#48)`.
 */
const EXEMPT: Array<{ pattern: RegExp; instead: string }> = [
  { pattern: /ralph-tts\.(sock|pid)/, instead: 'TODO(#48)' },
];

function walk(dir: string, matches: (name: string) => boolean): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full, matches));
    } else if (matches(entry)) {
      out.push(full);
    }
  }
  return out;
}

function scannedFiles(): string[] {
  return [
    ...walk(join(REPO_ROOT, 'src'), (n) => n.endsWith('.ts')),
    ...walk(join(REPO_ROOT, 'lib'), (n) => n.endsWith('.py')),
    ...walk(join(REPO_ROOT, 'agents'), (n) => n.endsWith('.md')),
    ...walk(join(REPO_ROOT, 'commands'), (n) => n.endsWith('.md')),
    join(REPO_ROOT, 'install.sh'),
  ];
}

interface Hit {
  file: string;
  line: number;
  text: string;
}

function unmarkedLegacyHits(): Hit[] {
  const hits: Hit[] = [];

  for (const file of scannedFiles()) {
    const lines = readFileSync(file, 'utf-8').split('\n');

    lines.forEach((line, i) => {
      if (!/ralph/i.test(line)) return;

      const exempt = EXEMPT.find((e) => e.pattern.test(line));
      const wanted = exempt ? exempt.instead : MARKER;

      const from = Math.max(0, i - LOOKBACK);
      const to = Math.min(lines.length, i + LOOKAHEAD + 1);
      const window = lines.slice(from, to).join('\n');
      if (window.includes(wanted)) return;

      hits.push({
        file: relative(REPO_ROOT, file),
        line: i + 1,
        text: line.trim(),
      });
    });
  }

  return hits;
}

describe('legacy reference markers', () => {
  test('every legacy reference in source carries a removal marker', () => {
    const unmarked = unmarkedLegacyHits();
    const report = unmarked.map((h) => `${h.file}:${h.line}: ${h.text}`).join('\n');
    expect(report).toBe('');
  });

  test('the marker string itself is stable', () => {
    // Both this test and a future `grep -rn "remove once all projects migrated"`
    // removal sweep depend on the exact wording. Changing it means changing both.
    const brand = readFileSync(join(REPO_ROOT, 'src/brand.ts'), 'utf-8');
    expect(brand).toContain(MARKER);
  });

  test('no shipped source references a dist/ or bin/ path under the old name', () => {
    const offenders: string[] = [];
    for (const file of scannedFiles()) {
      const content = readFileSync(file, 'utf-8');
      // install.sh legitimately creates the ~/.local/bin/ralph compatibility
      // symlink; what must not survive is a build-output path under the old name.
      for (const m of content.matchAll(/dist\/ralph/g)) {
        offenders.push(`${relative(REPO_ROOT, file)}: ${m[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
