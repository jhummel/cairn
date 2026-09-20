import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Round-17 review finding against task #122 (.cairn/reviews/round-17.md, '## Task #122' >
// 'Regression Risks', first bullet): #122 widened `include` to ["src","test"] and dropped
// `rootDir` so the typecheck gate could cover test/, but left `outDir: "dist"` with no
// `rootDir` and no `noEmit`. A bare `tsc` (no --noEmit) would then emit dist/src/** and
// dist/test/** into the same directory that holds the compiled dist/cairn binary that
// install.sh symlinks onto PATH. Fixed by setting `noEmit: true` (and dropping the now-inert
// `outDir`) so the safe behavior is the tsconfig default, not a property of how tsc happens
// to be invoked.
describe("tsconfig.json", () => {
  const tsconfig = JSON.parse(
    readFileSync(join(import.meta.dir, "..", "tsconfig.json"), "utf-8"),
  );

  test("noEmit is set so a bare tsc cannot write into dist/", () => {
    expect(tsconfig.compilerOptions.noEmit).toBe(true);
  });

  test("rootDir stays absent so test/ remains under the typecheck gate", () => {
    expect(tsconfig.compilerOptions.rootDir).toBeUndefined();
  });
});
