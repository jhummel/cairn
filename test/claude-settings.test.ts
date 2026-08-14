import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  ClaudeSettingsError,
  claudeSettingsPath,
  canonicalizeRule,
  mergeClaudeSettings,
  removeSettingsRules,
} from '../src/claude-settings';

// CRITICAL: every test operates inside a throwaway temp dir. Pointing this
// module at the real repository root would rewrite Cairn's own
// .claude/settings.local.json and destroy hand-accumulated permission rules.
let projectRoot: string;

beforeEach(() => {
  projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cairn-claude-settings-test-'));
});

afterEach(() => {
  fs.rmSync(projectRoot, { recursive: true, force: true });
});

function settingsFile(): string {
  return path.join(projectRoot, '.claude', 'settings.local.json');
}

function writeSettings(raw: string): void {
  fs.mkdirSync(path.join(projectRoot, '.claude'), { recursive: true });
  fs.writeFileSync(settingsFile(), raw);
}

function readSettings(): any {
  return JSON.parse(fs.readFileSync(settingsFile(), 'utf-8'));
}

describe('claudeSettingsPath', () => {
  it('resolves <projectRoot>/.claude/settings.local.json', () => {
    expect(claudeSettingsPath(projectRoot)).toBe(settingsFile());
  });
});

describe('canonicalizeRule', () => {
  it('treats Bash(x:*) and Bash(x *) as the same rule', () => {
    expect(canonicalizeRule('Bash(bun:*)')).toBe(canonicalizeRule('Bash(bun *)'));
  });

  it('keeps rules that differ before the suffix distinct', () => {
    expect(canonicalizeRule('Bash(git:*)')).not.toBe(canonicalizeRule('Bash(git diff:*)'));
    expect(canonicalizeRule('Bash(git *)')).not.toBe(canonicalizeRule('Bash(git diff *)'));
  });

  it('leaves non-suffix rules alone', () => {
    expect(canonicalizeRule('WebFetch(domain:api.github.com)')).toBe(
      'WebFetch(domain:api.github.com)'
    );
    expect(canonicalizeRule('Read(//tmp/**)')).toBe('Read(//tmp/**)');
  });

  it('does not apply Bash colon sugar to other tools', () => {
    // The `cmd:*` → `cmd *` equivalence is a Bash-specific shorthand; applying
    // it elsewhere could silently collapse two genuinely different rules.
    expect(canonicalizeRule('Read(x:*)')).not.toBe(canonicalizeRule('Read(x *)'));
  });

  it('ignores surrounding whitespace', () => {
    expect(canonicalizeRule('  Bash(bun test:*)  ')).toBe(canonicalizeRule('Bash(bun test:*)'));
  });
});

describe('mergeClaudeSettings — fresh file', () => {
  it('creates .claude/settings.local.json with the given allow rules', () => {
    const result = mergeClaudeSettings(projectRoot, { allow: ['Bash(bun test:*)', 'Read(//tmp/**)'] });

    expect(result.created).toBe(true);
    expect(result.addedAllow).toEqual(['Bash(bun test:*)', 'Read(//tmp/**)']);
    expect(result.addedDeny).toEqual([]);
    expect(readSettings()).toEqual({
      permissions: { allow: ['Bash(bun test:*)', 'Read(//tmp/**)'] },
    });
  });

  it('creates a deny array only when deny rules are supplied', () => {
    mergeClaudeSettings(projectRoot, { allow: ['Bash(ls:*)'] });
    expect(readSettings().permissions.deny).toBeUndefined();

    const result = mergeClaudeSettings(projectRoot, { deny: ['Bash(rm:*)'] });
    expect(result.addedDeny).toEqual(['Bash(rm:*)']);
    expect(readSettings().permissions).toEqual({
      allow: ['Bash(ls:*)'],
      deny: ['Bash(rm:*)'],
    });
  });

  it('dedupes within the supplied rule list', () => {
    const result = mergeClaudeSettings(projectRoot, {
      allow: ['Bash(bun:*)', 'Bash(bun *)', 'Bash(bun:*)'],
    });
    expect(result.addedAllow).toEqual(['Bash(bun:*)']);
    expect(readSettings().permissions.allow).toEqual(['Bash(bun:*)']);
  });

  it('is a no-op when there is nothing to add and no file exists', () => {
    const result = mergeClaudeSettings(projectRoot, { allow: [] });
    expect(result.created).toBe(false);
    expect(result.addedAllow).toEqual([]);
    expect(fs.existsSync(settingsFile())).toBe(false);
  });
});

describe('mergeClaudeSettings — merging into an existing file', () => {
  it('appends new rules and keeps existing ones in place', () => {
    writeSettings(
      JSON.stringify({ permissions: { allow: ['Bash(find:*)', 'Bash(gh api:*)'] } }, null, 2)
    );

    const result = mergeClaudeSettings(projectRoot, {
      allow: ['Bash(gh api:*)', 'Bash(bun run:*)'],
    });

    expect(result.created).toBe(false);
    expect(result.addedAllow).toEqual(['Bash(bun run:*)']);
    expect(readSettings().permissions.allow).toEqual([
      'Bash(find:*)',
      'Bash(gh api:*)',
      'Bash(bun run:*)',
    ]);
  });

  it('creates the permissions object when the file has none', () => {
    writeSettings(JSON.stringify({ model: 'opus' }, null, 2));

    mergeClaudeSettings(projectRoot, { allow: ['Bash(bun:*)'] });

    expect(readSettings()).toEqual({
      model: 'opus',
      permissions: { allow: ['Bash(bun:*)'] },
    });
  });

  it('creates only the missing array, leaving the sibling untouched', () => {
    writeSettings(JSON.stringify({ permissions: { deny: ['Bash(curl:*)'] } }, null, 2));

    mergeClaudeSettings(projectRoot, { allow: ['Bash(bun:*)'] });

    expect(readSettings().permissions).toEqual({
      deny: ['Bash(curl:*)'],
      allow: ['Bash(bun:*)'],
    });
  });

  it('merges allow and deny independently in one call', () => {
    writeSettings(
      JSON.stringify(
        { permissions: { allow: ['Bash(ls:*)'], deny: ['Bash(rm:*)'] } },
        null,
        2
      )
    );

    const result = mergeClaudeSettings(projectRoot, {
      allow: ['Bash(ls:*)', 'Bash(cat:*)'],
      deny: ['Bash(rm:*)', 'Bash(dd:*)'],
    });

    expect(result.addedAllow).toEqual(['Bash(cat:*)']);
    expect(result.addedDeny).toEqual(['Bash(dd:*)']);
    expect(readSettings().permissions).toEqual({
      allow: ['Bash(ls:*)', 'Bash(cat:*)'],
      deny: ['Bash(rm:*)', 'Bash(dd:*)'],
    });
  });
});

describe('mergeClaudeSettings — unknown key preservation', () => {
  it('round-trips hooks, env, model, statusLine and unrecognized keys', () => {
    const original = {
      model: 'claude-opus-5',
      env: { FOO: 'bar' },
      statusLine: { type: 'command', command: 'echo hi' },
      hooks: {
        PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'true' }] }],
      },
      someFutureKeyCairnHasNeverHeardOf: { nested: [1, 2, 3] },
      permissions: {
        allow: ['Bash(find:*)'],
        defaultMode: 'acceptEdits',
        additionalDirectories: ['/tmp'],
      },
    };
    writeSettings(JSON.stringify(original, null, 2));

    mergeClaudeSettings(projectRoot, { allow: ['Bash(bun:*)'] });

    const after = readSettings();
    expect(after.model).toEqual(original.model);
    expect(after.env).toEqual(original.env);
    expect(after.statusLine).toEqual(original.statusLine);
    expect(after.hooks).toEqual(original.hooks);
    expect(after.someFutureKeyCairnHasNeverHeardOf).toEqual(
      original.someFutureKeyCairnHasNeverHeardOf
    );
    expect(after.permissions.defaultMode).toBe('acceptEdits');
    expect(after.permissions.additionalDirectories).toEqual(['/tmp']);
    expect(after.permissions.allow).toEqual(['Bash(find:*)', 'Bash(bun:*)']);
  });
});

describe('mergeClaudeSettings — malformed input refusal', () => {
  it('throws and leaves a malformed file byte-for-byte intact', () => {
    const raw = '{ "permissions": { "allow": ["Bash(find:*)",  <-- oops';
    writeSettings(raw);

    expect(() => mergeClaudeSettings(projectRoot, { allow: ['Bash(bun:*)'] })).toThrow(
      ClaudeSettingsError
    );
    expect(fs.readFileSync(settingsFile(), 'utf-8')).toBe(raw);
  });

  it('refuses a top-level value that is not an object', () => {
    const raw = '["Bash(find:*)"]';
    writeSettings(raw);

    expect(() => mergeClaudeSettings(projectRoot, { allow: ['Bash(bun:*)'] })).toThrow(
      ClaudeSettingsError
    );
    expect(fs.readFileSync(settingsFile(), 'utf-8')).toBe(raw);
  });

  it('refuses a non-object permissions value', () => {
    const raw = JSON.stringify({ permissions: 'everything' });
    writeSettings(raw);

    expect(() => mergeClaudeSettings(projectRoot, { allow: ['Bash(bun:*)'] })).toThrow(
      ClaudeSettingsError
    );
    expect(fs.readFileSync(settingsFile(), 'utf-8')).toBe(raw);
  });

  it('refuses a non-array allow list', () => {
    const raw = JSON.stringify({ permissions: { allow: 'Bash(find:*)' } });
    writeSettings(raw);

    expect(() => mergeClaudeSettings(projectRoot, { allow: ['Bash(bun:*)'] })).toThrow(
      ClaudeSettingsError
    );
    expect(fs.readFileSync(settingsFile(), 'utf-8')).toBe(raw);
  });

  it('names the offending file in the error message', () => {
    writeSettings('not json at all');
    let message = '';
    try {
      mergeClaudeSettings(projectRoot, { allow: ['Bash(bun:*)'] });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain(settingsFile());
  });

  it('leaves a malformed file alone even when there is nothing to add', () => {
    const raw = 'still not json';
    writeSettings(raw);

    expect(() => mergeClaudeSettings(projectRoot, { allow: [] })).toThrow(ClaudeSettingsError);
    expect(fs.readFileSync(settingsFile(), 'utf-8')).toBe(raw);
  });
});

describe('mergeClaudeSettings — idempotency', () => {
  it('adds nothing and reports nothing on a second identical run', () => {
    const rules = { allow: ['Bash(bun test:*)', 'Bash(git diff:*)'], deny: ['Bash(rm:*)'] };

    mergeClaudeSettings(projectRoot, rules);
    const first = fs.readFileSync(settingsFile(), 'utf-8');

    const second = mergeClaudeSettings(projectRoot, rules);

    expect(second.created).toBe(false);
    expect(second.addedAllow).toEqual([]);
    expect(second.addedDeny).toEqual([]);
    expect(fs.readFileSync(settingsFile(), 'utf-8')).toBe(first);
  });

  it('does not rewrite the file when nothing is added', () => {
    const raw = '{"permissions":{"allow":["Bash(bun:*)"]},"model":"opus"}';
    writeSettings(raw);

    const result = mergeClaudeSettings(projectRoot, { allow: ['Bash(bun:*)'] });

    expect(result.addedAllow).toEqual([]);
    // Untouched formatting proves no write happened at all.
    expect(fs.readFileSync(settingsFile(), 'utf-8')).toBe(raw);
  });

  it('leaves no temp files behind', () => {
    mergeClaudeSettings(projectRoot, { allow: ['Bash(bun:*)'] });
    mergeClaudeSettings(projectRoot, { allow: ['Bash(git:*)'] });

    const entries = fs.readdirSync(path.join(projectRoot, '.claude'));
    expect(entries).toEqual(['settings.local.json']);
  });
});

describe('mergeClaudeSettings — suffix-equivalent dedupe', () => {
  it('does not re-add Bash(bun:*) when the user already wrote Bash(bun *)', () => {
    writeSettings(JSON.stringify({ permissions: { allow: ['Bash(bun *)'] } }, null, 2));

    const result = mergeClaudeSettings(projectRoot, { allow: ['Bash(bun:*)'] });

    expect(result.addedAllow).toEqual([]);
    // The user's own spelling must never be rewritten.
    expect(readSettings().permissions.allow).toEqual(['Bash(bun *)']);
  });

  it('does not re-add Bash(bun *) when Bash(bun:*) is already present', () => {
    writeSettings(JSON.stringify({ permissions: { allow: ['Bash(bun:*)'] } }, null, 2));

    const result = mergeClaudeSettings(projectRoot, { allow: ['Bash(bun *)'] });

    expect(result.addedAllow).toEqual([]);
    expect(readSettings().permissions.allow).toEqual(['Bash(bun:*)']);
  });

  it('keeps Bash(git:*) and Bash(git diff:*) as distinct rules', () => {
    writeSettings(JSON.stringify({ permissions: { allow: ['Bash(git *)'] } }, null, 2));

    const result = mergeClaudeSettings(projectRoot, {
      allow: ['Bash(git:*)', 'Bash(git diff:*)'],
    });

    expect(result.addedAllow).toEqual(['Bash(git diff:*)']);
    expect(readSettings().permissions.allow).toEqual(['Bash(git *)', 'Bash(git diff:*)']);
  });

  it('dedupes suffix-equivalents against allow and deny independently', () => {
    writeSettings(
      JSON.stringify({ permissions: { allow: ['Bash(ls *)'], deny: ['Bash(rm *)'] } }, null, 2)
    );

    const result = mergeClaudeSettings(projectRoot, {
      allow: ['Bash(ls:*)', 'Bash(rm:*)'],
      deny: ['Bash(rm:*)'],
    });

    // Bash(rm:*) is in the deny list, not the allow list — it is still new to allow.
    expect(result.addedAllow).toEqual(['Bash(rm:*)']);
    expect(result.addedDeny).toEqual([]);
  });
});

// --- removeSettingsRules ---
//
// The migration counterpart to mergeClaudeSettings: it strips rules a previous
// version of `cairn init` seeded, and must be every bit as conservative about
// the rest of the user's file as the additive path is.

const LEGACY_DENY = [
  'Bash(cairn task start:*)',
  'Bash(cairn task complete:*)',
  'Bash(cairn task set-status:*)',
  'Bash(cairn task add:*)',
  'Bash(cairn task note:*)',
];

describe('removeSettingsRules — no-op cases', () => {
  it('reports nothing removed and creates no file when settings are absent', () => {
    const result = removeSettingsRules(projectRoot, { deny: LEGACY_DENY });

    expect(result.removedAllow).toEqual([]);
    expect(result.removedDeny).toEqual([]);
    expect(result.settingsPath).toBe(settingsFile());
    expect(fs.existsSync(settingsFile())).toBe(false);
  });

  it('leaves an already-clean file byte-for-byte untouched', () => {
    const raw = JSON.stringify(
      { permissions: { allow: ['Bash(git diff:*)'], deny: ['Bash(rm:*)'] }, model: 'opus' },
      null,
      2
    );
    writeSettings(raw);

    const result = removeSettingsRules(projectRoot, { deny: LEGACY_DENY });

    expect(result.removedDeny).toEqual([]);
    expect(fs.readFileSync(settingsFile(), 'utf-8')).toBe(raw);
  });

  it('leaves a file with no permissions key untouched', () => {
    const raw = JSON.stringify({ model: 'opus' }, null, 2);
    writeSettings(raw);

    const result = removeSettingsRules(projectRoot, { deny: LEGACY_DENY });

    expect(result.removedDeny).toEqual([]);
    expect(fs.readFileSync(settingsFile(), 'utf-8')).toBe(raw);
  });

  it('removes nothing when handed an empty rule set', () => {
    const raw = JSON.stringify({ permissions: { deny: LEGACY_DENY } }, null, 2);
    writeSettings(raw);

    const result = removeSettingsRules(projectRoot, {});

    expect(result.removedDeny).toEqual([]);
    expect(fs.readFileSync(settingsFile(), 'utf-8')).toBe(raw);
  });
});

describe('removeSettingsRules — stripping the legacy cairn task deny block', () => {
  it('drops the deny key entirely when removal empties it', () => {
    writeSettings(JSON.stringify({ permissions: { deny: LEGACY_DENY } }, null, 2));

    const result = removeSettingsRules(projectRoot, { deny: LEGACY_DENY });

    expect(result.removedDeny).toEqual(LEGACY_DENY);
    expect(readSettings().permissions).not.toHaveProperty('deny');
  });

  it('keeps unrelated user deny rules and removes only the legacy five', () => {
    writeSettings(
      JSON.stringify(
        {
          permissions: {
            deny: [
              'Bash(rm -rf:*)',
              'Bash(cairn task start:*)',
              'Read(./secrets/**)',
              'Bash(cairn task complete:*)',
              'Bash(cairn task set-status:*)',
              'Bash(cairn task add:*)',
              'Bash(cairn task note:*)',
              'Bash(curl:*)',
            ],
          },
        },
        null,
        2
      )
    );

    const result = removeSettingsRules(projectRoot, { deny: LEGACY_DENY });

    expect(result.removedDeny).toEqual(LEGACY_DENY);
    expect(readSettings().permissions.deny).toEqual([
      'Bash(rm -rf:*)',
      'Read(./secrets/**)',
      'Bash(curl:*)',
    ]);
  });

  it('matches the spaced form and reports the spelling found on disk', () => {
    writeSettings(
      JSON.stringify(
        { permissions: { deny: ['Bash(cairn task start *)', '  Bash(cairn task add:*)  '] } },
        null,
        2
      )
    );

    const result = removeSettingsRules(projectRoot, { deny: LEGACY_DENY });

    expect(result.removedDeny).toEqual(['Bash(cairn task start *)', '  Bash(cairn task add:*)  ']);
    expect(readSettings().permissions).not.toHaveProperty('deny');
  });

  it('never touches the allow list when only deny rules are supplied', () => {
    writeSettings(
      JSON.stringify(
        {
          permissions: {
            allow: ['Bash(cairn task start:*)', 'Bash(git diff:*)'],
            deny: LEGACY_DENY,
          },
        },
        null,
        2
      )
    );

    const result = removeSettingsRules(projectRoot, { deny: LEGACY_DENY });

    expect(result.removedAllow).toEqual([]);
    expect(readSettings().permissions.allow).toEqual([
      'Bash(cairn task start:*)',
      'Bash(git diff:*)',
    ]);
  });

  it('removes from the allow list too when allow rules are supplied', () => {
    writeSettings(
      JSON.stringify({ permissions: { allow: ['Bash(ls:*)', 'Bash(rm:*)'] } }, null, 2)
    );

    const result = removeSettingsRules(projectRoot, { allow: ['Bash(rm:*)'] });

    expect(result.removedAllow).toEqual(['Bash(rm:*)']);
    expect(readSettings().permissions.allow).toEqual(['Bash(ls:*)']);
  });

  it('preserves unknown top-level and permissions keys', () => {
    writeSettings(
      JSON.stringify(
        {
          model: 'opus',
          hooks: { PreToolUse: [] },
          permissions: {
            defaultMode: 'acceptEdits',
            additionalDirectories: ['../shared'],
            allow: ['Bash(git diff:*)'],
            deny: LEGACY_DENY,
          },
        },
        null,
        2
      )
    );

    removeSettingsRules(projectRoot, { deny: LEGACY_DENY });

    const settings = readSettings();
    expect(settings.model).toBe('opus');
    expect(settings.hooks).toEqual({ PreToolUse: [] });
    expect(settings.permissions.defaultMode).toBe('acceptEdits');
    expect(settings.permissions.additionalDirectories).toEqual(['../shared']);
    expect(settings.permissions.allow).toEqual(['Bash(git diff:*)']);
  });

  it('preserves non-string entries the user somehow left in the list', () => {
    writeSettings(
      JSON.stringify({ permissions: { deny: [42, 'Bash(cairn task add:*)'] } }, null, 2)
    );

    const result = removeSettingsRules(projectRoot, { deny: LEGACY_DENY });

    expect(result.removedDeny).toEqual(['Bash(cairn task add:*)']);
    expect(readSettings().permissions.deny).toEqual([42]);
  });

  it('writes trailing-newline JSON and leaves no temp file behind', () => {
    writeSettings(JSON.stringify({ permissions: { deny: LEGACY_DENY } }, null, 2));

    removeSettingsRules(projectRoot, { deny: LEGACY_DENY });

    const raw = fs.readFileSync(settingsFile(), 'utf-8');
    expect(raw.endsWith('\n')).toBe(true);
    const leftovers = fs
      .readdirSync(path.join(projectRoot, '.claude'))
      .filter((f) => f !== 'settings.local.json');
    expect(leftovers).toEqual([]);
  });
});

describe('removeSettingsRules — malformed input refusal', () => {
  it('throws and leaves unparseable JSON exactly as found', () => {
    writeSettings('{ not json');

    expect(() => removeSettingsRules(projectRoot, { deny: LEGACY_DENY })).toThrow(
      ClaudeSettingsError
    );
    expect(fs.readFileSync(settingsFile(), 'utf-8')).toBe('{ not json');
  });

  it('throws when the top level is not an object', () => {
    writeSettings('["Bash(cairn task start:*)"]');

    expect(() => removeSettingsRules(projectRoot, { deny: LEGACY_DENY })).toThrow(
      ClaudeSettingsError
    );
    expect(fs.readFileSync(settingsFile(), 'utf-8')).toBe('["Bash(cairn task start:*)"]');
  });

  it('throws when permissions.deny is not an array', () => {
    const raw = JSON.stringify({ permissions: { deny: 'Bash(cairn task start:*)' } }, null, 2);
    writeSettings(raw);

    expect(() => removeSettingsRules(projectRoot, { deny: LEGACY_DENY })).toThrow(
      ClaudeSettingsError
    );
    expect(fs.readFileSync(settingsFile(), 'utf-8')).toBe(raw);
  });
});
