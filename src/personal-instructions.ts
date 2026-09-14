import * as fs from 'fs';
import * as path from 'path';

// `instructions.md` is deprecated in favor of Claude Code's native
// `CLAUDE.local.md` (see `cairn init`, which offers to migrate it). This loader
// keeps working for one release so existing projects don't lose personal
// instructions outright, but warns once per process so the deprecation is
// visible without spamming every agent's stderr.
let warnedDeprecated = false;

/** Test-only: clears the once-per-process deprecation warning latch. */
export function resetPersonalInstructionsDeprecationWarning(): void {
  warnedDeprecated = false;
}

export function loadPersonalInstructions(dataDir: string): string {
  const instructionsFile = path.join(dataDir, 'instructions.md');
  if (fs.existsSync(instructionsFile)) {
    const content = fs.readFileSync(instructionsFile, 'utf-8');
    if (content.trim()) {
      if (!warnedDeprecated) {
        warnedDeprecated = true;
        console.error(
          'instructions.md is deprecated; move it to CLAUDE.local.md (re-run `cairn init` to migrate).',
        );
      }
      return `\nPERSONAL INSTRUCTIONS:\n${content}\n`;
    }
  }
  return '';
}
