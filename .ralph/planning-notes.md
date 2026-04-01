## Context

Ralph's TypeScript rewrite is complete and the planning flow simplification (slash commands, single-session plan) shipped in the previous round. The narration system — a Python TTS server (`lib/ralph_narrate_server.py`) managed from TypeScript (`src/narration.ts`, `src/commands/narrate.ts`) — has a protocol bug that prevents the server from passing health checks, causing `ralph narrate on` to always fail.

## Goals

Fix the narration server health check so `ralph narrate on` works reliably.

## Approach

### Bug 1: Health check protocol mismatch (root cause)

The Python server's `handle_client()` reads in a loop until EOF (`conn.recv(4096)` returns empty bytes), *then* checks if the message was "PING" and responds with "PONG". But the Node.js `checkNarrationHealth()` sends `PING\n` and waits for a response *without closing the write side of the socket*. The Python side never sees EOF, so it blocks in `recv()` forever, never sends PONG, and the health check times out.

**Fix in `src/narration.ts` (`checkNarrationHealth`):** After `socket.write('PING\n')`, call `socket.end()` to half-close the write side. This signals EOF to the Python server, which then processes the PING and responds with PONG. The Node socket can still read the response after half-closing writes.

### Bug 2: Startup timeout too tight

KPipeline (Kokoro TTS model) initialization takes ~7-9 seconds before the socket is even created. The current health check window is 10 retries × 1 second = 10 seconds. This leaves only 1-3 retries after the socket appears, which is fragile.

**Fix in `src/narration.ts` (`startNarrationServer`):** Bump `MAX_RETRIES` from 10 to 30. This gives a comfortable 30-second window for model loading + socket creation + health check response. The 1-second retry interval is fine.

### Update tests

The existing narration tests mock the health check and sleep functions, so they won't need major changes for the timeout bump. But the `checkNarrationHealth` tests should verify that `socket.end()` is called after writing PING. If there are integration-style tests, they should confirm the half-close behavior.

## Rejected Alternatives

- **Use Anthropic TS SDK instead of shelling out to claude:** Rejected for now. Shelling out to `claude -p` gives us Claude Code's full tool suite, permissions model, and MCP support for free. Can revisit later.
- **Port narration to TypeScript:** Rejected for now. Kokoro TTS and sounddevice are Python-specific audio libraries. Keep narration as a Python subprocess spawned from TS.
- **Skills instead of subagents for task generation/review:** Considered having the slash commands execute within the same session context (no Agent tool, the planning agent just does the work). Rejected — clean context matters for task generation (avoids bias from conversational tangents) and review (independent evaluation). Subagents via Agent tool get fresh context while still having full tool access.
- **Dynamically generated slash commands:** Considered having ralph write `.claude/commands/` files at plan time with templated project-specific values. Rejected in favor of static files copied during `ralph init` — easier to version, edit, and customize. The subagent can read project context from files at runtime.
- **Regenerator as separate slash command:** Considered keeping a `/regenerate-tasks` command. Rejected — if the review finds issues, the user can ask the planning agent conversationally or just re-run `/generate-tasks`. Separate regenerator adds complexity without clear benefit.
- **Gating command installation behind a prompt:** Considered asking "Install planning slash commands?" during init. Rejected — these are always useful and non-invasive (they go in `.claude/commands/` which is standard Claude Code). Install unconditionally.
- **Post-task review blocks archival:** Considered having review failures revert task status or block archival. Rejected — this is informational only for now. Let the human read `review-post.md` and decide what to do. Can add blocking behavior later if the signal proves reliable.
- **Review using HEAD~1 instead of SHA capture:** Considered diffing against `HEAD~1` for simplicity. Rejected — agents may make multiple commits or amend, so `HEAD~1` wouldn't capture the full delta. Capturing SHA before the agent runs and diffing `<before>..HEAD` is more robust.
- **Fix on the Python side instead of Node side:** Considered changing the Python server to use a line-based protocol (read until `\n` instead of EOF). Rejected — the EOF-based protocol is correct for the narration data path (variable-length JSON payloads). The PING health check is the special case, and the simpler fix is to have the Node client half-close after sending PING, which is the correct socket protocol for "I'm done sending."
- **Longer sleep instead of more retries:** Considered using fewer retries with longer sleep intervals (e.g., 5 × 3s). Rejected — 1-second polling gives faster startup feedback when the server is ready quickly, and 30 × 1s still has a reasonable total timeout.

## Rough Task Outline

1. Fix `checkNarrationHealth()` to half-close socket after PING — add `socket.end()` after `socket.write('PING\n')`. Update corresponding tests. — `src/narration.ts`, `test/narration.test.ts`
2. Bump `MAX_RETRIES` from 10 to 30 in `startNarrationServer()` — gives 30s window for slow Kokoro init. Update any tests that assert on retry count. — `src/narration.ts`, `test/narration.test.ts`
3. Verify build + test suite — `bun test`, `bun run build`, manual smoke test `ralph narrate on && ralph narrate status && ralph narrate off`. — `/`

## Open Questions

None.
