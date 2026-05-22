# Handoff — E2E Testing Session

## Project

**smallcode-harness** — pi extension that ports SmallCode's small-model compensatory patterns. Makes pi work better with local models (8B-35B).

**Repo:** `github.com/chirvo/smallcode-harness`
**Branch:** `main` (9 commits, latest `b84f941`)

## What's Implemented (13 modules)

### Core (8 modules — ported from SmallCode)

| Module | File | What it does |
|---|---|---|
| Bootstrap Detector | `src/bootstrap-detector.ts` | Auto-classifies project on session start (runtime, framework, test command) |
| Read-Before-Write | `src/read-tracker.ts` | Blocks writes to unread existing files. SINGLE tool_call handler (critical fix from earlier bug) |
| Early-Stop | `src/early-stop.ts` | Repetition loops, greeting regression, patch spiral detection |
| Plan Anchor | `src/plan-anchor.ts` | Numbered plan extraction + progress bar. **Known issue:** stale plan persistence (fixed with `input` clearing, `/plan-clear`, 3-turn expiry) |
| Error Diagnosis | `src/error-diagnosis.ts` | Bash failure → structured `[ERROR-DIAGNOSIS]` hint (pure regex, zero LLM calls) |
| Trust Decay | `src/trust-decay.ts` | Disables tools after 5 consecutive failures. Soft-demotes at 3. |
| Adaptive Temp | `src/adaptive-temp.ts` | Varies retry temperature per attempt (-0.15, +0.15, 0) |
| Semantic Merge | `src/semantic-merge.ts` | Fuzzy merge recovery when edit `old_str` doesn't match |

### DX Improvements (5 modules — ported later)

| Module | File | What it does |
|---|---|---|
| Auto-Validate | `src/auto-validate.ts` | After every write/edit, runs compile check. Injects errors so model self-corrects |
| Evidence Store | `src/evidence.ts` | Cross-session memory: "what worked, what failed." Surfaces past learnings |
| Multi-File Edit | `src/multi-file-edit.ts` | When 3+ files change in a turn, injects `[MULTI-FILE-EDIT]` coordination header |
| Snapshot | `src/snapshot.ts` | Before each turn, snapshots file state. Supports rollback of all edits |
| Task Decomposition | `src/task-decomposition.ts` | After 2+ consecutive edit failures, suggests split/one-error/rewrite strategy |

### Infrastructure

| File | What it does |
|---|---|
| `src/index.ts` | Entry point. Registers all modules with error boundaries (registration + runtime) |
| `src/state.ts` | `HarnessStateManager` — singleton state: read tracker, trust scores, plan, evidence |
| `src/config.ts` | Centralized env var config with defaults + bool parsing |
| `src/log.ts` | Structured file logging to `.smallcode/sc-harness.log` (`SMALLCODE_LOG_LEVEL`) |

## Test Status

**93 tests, 0 failures, 192 assertions, ~400ms runtime.**

| Test file | Tests | Type |
|---|---|---|
| `test/unit/bootstrap-detector.test.ts` | 13 | Real temp dirs with actual package.json/Cargo.toml files |
| `test/unit/early-stop.test.ts` | 7 | Pure function tests for repetition and greeting detection |
| `test/unit/error-diagnosis.test.ts` | 7 | Pure function tests for error classification + file extraction |
| `test/unit/plan-anchor.test.ts` | 14 | Plan extraction, dependency batches, stale-plan clearing logic |
| `test/unit/semantic-merge.test.ts` | 3 | Fuzzy merge, exact match, no-match |
| `test/unit/state.test.ts` | 9 | HarnessStateManager with mock pi |
| `test/unit/error-boundary.test.ts` | 3 | Handler isolation — throwing handler doesn't crash siblings |
| `test/unit/auto-validate.test.ts` | 6 | Real JS/JSON/Python/TS validation commands |
| `test/unit/evidence.test.ts` | 11 | Suggestion generation, file extraction, notable detection |
| `test/unit/multi-file-edit.test.ts` | 4 | Coordination header format and ordering |
| `test/unit/snapshot.test.ts` | 8 | Checkpoint, rollback, commit, containment |
| `test/unit/task-decomposition.test.ts` | 5 | Strategy selection by file size and error count |
| `test/smoke/load.test.ts` | 2 | Extension exports and event registration |

### Running tests

```bash
bun test              # all 93 tests
bun test:unit         # unit tests only
bun test:smoke        # smoke tests only
bun test:watch        # watch mode for TDD
bun test:e2e          # E2E smoke script (requires running model)
bun qa                # typecheck + test + E2E
```

## What Needs E2E Testing

These features require a running pi + model to verify. The smoke script `test/smoke/qa.sh` automates most of it.

### 1. Bootstrap Detection
- **Test:** Start pi in a project with package.json. First turn should inject `[PROJECT BOOTSTRAP]` with runtime, framework, test command.
- **Manual:** `pi --model qwen3:8b --print "what did you detect?"`
- **Verify:** Output contains `Runtime: node`, `Framework: Express`, `Test: jest`

### 2. Read-Before-Write Guard
- **Test:** Model tries to write to an existing file it hasn't read. Should be blocked on first attempt.
- **Manual:** `pi --print "overwrite package.json with {\"name\":\"crash\"}"`
- **Verify:** Blocked with "File not read. Use read first."
- **Known bug fixed:** This used two separate `pi.on("tool_call")` handlers that conflicted. Now merged into ONE handler in `read-tracker.ts`.

### 3. Read-Loop Detection
- **Test:** Model reads 5+ files consecutively without writing. Soft nudge at 5, hard stop at 8.
- **Manual:** Guide model through 8 consecutive reads.
- **Verify:** "You have read 5 files" message at 5, "STOP reading and START writing" at 8.

### 4. Plan Anchor
- **Test:** Model outputs a numbered plan. Subsequent turns show `ACTIVE PLAN (step X of Y)`.
- **Manual:** `pi --print "create a REST API with 1. GET 2. POST 3. error handling 4. tests"`
- **Verify:** Output contains `ACTIVE PLAN` with numbered steps.

### 5. Plan Anchor — Stale Plan Clearing
- **Test:** After a plan is extracted, type a new unrelated message. The plan should clear.
- **Manual:** After plan appears, type `"what's the weather like?"` — plan should clear on next turn.
- **Fallback:** `/plan-clear` command manually clears the plan.
- **Known issue:** Plans extracted from previous conversations persist via `appendEntry` and never advance because only edit/bash tool calls trigger step advancement. The fix (committed in `e3035b5`) adds input detection for stale plans, 3-turn expiry, and `/plan-clear`.

### 6. Error Diagnosis
- **Test:** Run a command that doesn't exist. `[ERROR-DIAGNOSIS]` line prepended to output.
- **Manual:** `pi --print "run bogus-command-12345"`
- **Verify:** Output contains `[ERROR-DIAGNOSIS] Type: notfound. Fix: Install the command or check spelling`

### 7. Trust Decay
- **Test:** A tool that fails 5+ times consecutively is disabled.
- **Manual:** Create a broken MCP server, have the model try to use it.
- **Verify:** Tool dropped from active tools, notification: `Disabled tool "toolname" (5 consecutive failures)`

### 8. Auto-Validate
- **Test:** Model writes a file with syntax errors. Validation runs, error is injected back so model self-corrects.
- **Manual:** `pi --print "create bad.js with const x = "` — model writes, validation fails, model fixes.
- **Verify:** `[VALIDATION-FAILED]` message appears after the write.

### 9. Evidence Store
- **Test:** Run a failing command, then later a similar failing command. Past evidence surfaces.
- **Manual:** `pi --print "run az"` (fails), then `pi --print "run azure"` (similar command).
- **Verify:** First failure recorded. Second command shows `[EVIDENCE]` from the first.

### 10. Multi-File Edit
- **Test:** When 3+ files are edited in one turn, a coordination header is injected.
- **Manual:** Ask model to modify 3+ files. Look for `[MULTI-FILE-EDIT]` header.
- **Verify:** Header lists all files, includes "Complete ALL files" instruction.

### 11. Snapshot & Rollback
- **Test:** If a write/edit fails validation, files are rolled back to pre-turn state.
- **Manual:** Force a validation failure scenario.
- **Verify:** Files restored to original content after failed edit.

### 12. Task Decomposition
- **Test:** After 2+ consecutive edit failures on the same file, model receives decomposition suggestion.
- **Manual:** Create a scenario where the model keeps failing to edit a file.
- **Verify:** `[DECOMPOSE]` message with strategy (split_file, one_error_at_a_time, rewrite_section).

### 13. Environment Variable Toggles
- **Test:** Each module can be disabled independently.
- **Manual:** `SMALLCODE_BOOTSTRAP=false SMALLCODE_WRITE_GUARD=false pi`
- **Verify:** Features don't activate. Log shows "Disabled by config" for each.

## Known Issues

1. **Plan anchor persists stale state across sessions.** The plan extracts numbered lists from LLM responses and persists via `appendEntry`. It only advances on edit/bash tool calls, so plans extracted during text-only conversations never advance. Fixed with input detection + `/plan-clear` + 3-turn expiry. Reload pi after pulling `e3035b5`.

2. **Error-diagnosis test shows `[ERROR-DIAGNOSIS]` in test output.** The error-diagnosis module activates during `bun test` because it intercepts real `tool_result` events from the mock pi. Harmless — the tests still pass.

3. **Auto-validate TS test is slow.** The "TypeScript with tsconfig" test runs `npx tsc` in a temp dir, takes ~300ms. All other tests complete in ~100ms total.

4. **No `SMALLCODE_AUTO_VALIDATE` env var test.** The auto-validate module is registered but its env toggle in config.ts is `SMALLCODE_AUTO_VALIDATE`. This hasn't been manually verified to disable the feature.

## Next Steps

1. Run `test/smoke/qa.sh` with a real model to verify the 4 automated tests
2. Manually test stale-plan clearing after reloading pi
3. Test auto-validate with a real model writing broken code
4. Test evidence store with cross-session memory persistence
5. Test snapshot rollback by forcing a validation failure
