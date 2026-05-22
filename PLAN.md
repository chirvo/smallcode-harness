# SmallCode Harness — Pi Extension Plan

**Goal:** Extract SmallCode's small-model compensations into a reusable pi extension package that makes pi work better with local models (8B-35B).

---

## Why This Matters

Pi assumes frontier models with 128k+ context and reliable tool calling. SmallCode's core insight is that **small models need different infrastructure** — and 7 of SmallCode's 15+ compensatory patterns map perfectly onto pi's event system.

| Small Model Problem | SmallCode Solution | Pi Extension Equivalent |
|---|---|---|
| Forgets what step they're on | Plan anchor injected every turn | `before_agent_start` → inject progress bar |
| Read endlessly without producing | Read-loop detection | `tool_call` → count read calls, inject nudge at 5/8 |
| Overwrite files they never read | Read-before-write guard | `tool_call` on `write` → check read tracker |
| Loop on same broken output | Adaptive retry temperature | `context` → override temp on retry |
| Repeat same LLM output in loop | Repetition loop detection | `tool_result` → pattern-match streaming output |
| Stuck on corrupted patches | Patch spiral detection | `tool_call` on `edit` → track failures per file |
| Waste 3-5 calls discovering the project | Bootstrap detection | `session_start` → classify project once |
| Produce same wrong answer repeatedly | Tool trust decay | `tool_result` → track consecutive failures per tool |
| Can't read stderr effectively | Error diagnosis | `tool_result` on `bash` → quick LLM call for structured hint |
| Hard-fail when patch `old_str` moves | Semantic merge recovery | `tool_result` on `edit` → fallback merge attempt |

---

## Package Structure

```
smallcode-harness/
├── package.json              # pi package manifest
├── README.md                 # Usage docs
├── SKILL.md                  # Skill: how the LLM should use this package
├── src/
│   ├── index.ts              # Entry point — registers all modules
│   ├── state.ts              # Shared state (read tracker, tool scores, etc.)
│   │
│   ├── bootstrap-detector.ts # Project auto-classification on session_start
│   ├── read-tracker.ts       # Read-before-write guard
│   ├── early-stop.ts         # Repetition + read-loop + patch-spiral detection
│   ├── plan-anchor.ts        # Numbered plan extraction + progress bar
│   ├── error-diagnosis.ts    # Bash failure → structured fix hint
│   ├── trust-decay.ts        # Per-tool consecutive-failure tracking
│   ├── adaptive-temp.ts      # Retry temperature variation
│   └── semantic-merge.ts     # Patch recovery when old_str moves
│
├── test/
│   └── unit.test.ts          # Unit tests for each module
└── .gitignore
```

---

## Module-by-Module Plan

### 1. `state.ts` — Shared Session State

**What it does:** Central store for all cross-turn state that SmallCode would store in memory store or disk JSON. Persisted via `pi.appendEntry()` so it survives `/reload` and session restores.

**State managed:**
- Read tracker: `Set<string>` of file paths read this session
- Tool trust scores: `Map<toolName, {consecutiveFailures, totalCalls}>`
- Plan state: `{steps: string[], currentStep: number, completed: Set<number>}`
- Bootstrap info: `{runtime, framework, testCommand, entryPoint, packageManager}` — set once

**Extracted from SmallCode:**
- `src/tools/read_tracker.js` — read tracking with `recordRead()` / `checkWrite()` / `recordWrite()`
- `src/model/adaptive_temp.js` — retry attempt counters
- `bin/governor.js` — `ToolScorer` class with success/failure tracking
- `src/session/plan_tracker.js` — plan step tracking

**Pi APIs used:**
- `pi.appendEntry("sc-harness-state", { ... })` — persist on every mutation
- `pi.on("session_start")` — restore from branch entries
- `pi.on("session_shutdown")` — flush state

---

### 2. `bootstrap-detector.ts` — Project Auto-Classification

**What it does:** On first turn of a session, scans workspace and injects a compact project summary: runtime + version, package manager, framework, test/run/build commands. This is SmallCode's Feature 8 — eliminates 3-5 tool calls small models waste discovering what kind of project they're in.

**Detection logic (all pure code, zero LLM calls):**
- `package.json` → Node.js runtime, package manager from lockfile, framework from dependencies, entry point from `"main"` or `"bin"`
- `pyproject.toml` + `Pipfile` / `requirements.txt` → Python runtime, framework (Django/FastAPI/Flask), test runner (pytest), entry point
- `Cargo.toml` → Rust, test command (`cargo test`), build (`cargo build`)
- `go.mod` → Go, test command (`go test ./...`), entry point (`main.go` or `cmd/`)
- `Gemfile` → Ruby, test runner
- `pom.xml` / `build.gradle` → Java/Groovy

**Output format (injected via `before_agent_start`):**
```
[PROJECT BOOTSTRAP]
Runtime: node v20.11.0
Package manager: pnpm (pnpm-lock.yaml)
Framework: Next.js 14.2.0
Entry point: src/app/page.tsx
Test: pnpm vitest run
Build: pnpm build
Run: pnpm dev
```

**Extracted from SmallCode:**
- `src/session/bootstrap.js` — the full bootstrap detector with regex-based framework detection

**Pi APIs used:**
- `pi.on("session_start")` — trigger detection once
- `pi.on("before_agent_start")` — inject bootstrap context as system prompt appendage

---

### 3. `read-tracker.ts` — Read-Before-Write Guard

**What it does:** Small models regularly overwrite files with incorrect content when they haven't internalized what's already there. This guard tracks which paths the model has `read` this session. First `write` to an unread existing file is refused with a hint. Second attempt is allowed (legitimate full-replace intent).

**Logic:**
```
on tool_call("read"):
    track file as "read"

on tool_call("write") or tool_call("edit"):
    if file exists and !file.read and first_attempt:
        return { block: true, reason: "File not read. Use read first, or retry to force overwrite." }
    if file exists and !file.read and second_attempt:
        allow (legitimate replace intent)
    if new file (doesn't exist):
        allow (no prior state to check)
```

**Extracted from SmallCode:**
- `src/tools/read_tracker.js` — `recordRead()`, `checkWrite()`, `recordWrite()` methods
- `bin/executor.js` — the guard implementation in `case 'write_file'`

**Pi APIs used:**
- `pi.on("tool_call")` with `isToolCallEventType` for `read`, `write`, `edit`
- Return `{ block: true, reason: "..." }` to prevent execution

---

### 4. `early-stop.ts` — Degenerate Behavior Detection

**What it does:** Three detectors that catch common small-model failure modes that waste tokens:

**A. Repetition Loop Detector:**
- Monitors assistant streaming output for repeated patterns
- At `repetitionThreshold` (default 3) identical windowSize patterns in the tail of output
- Injects correction: "You are repeating. Take a different approach."

```
on message_end (streaming assistant message):
    check tail of content for repeating 50-120 char windows
    if pattern repeats >= 3 times:
        inject correction message
```

**B. Read-Only Loop Detector:**
- Counts consecutive read-only tool calls (`read`, `grep`, `find`, `ls`) without any write
- At 5: inject soft nudge "you likely have enough context"
- At 8: inject hard stop "STOP reading and START writing"

```
on tool_call("read"|"grep"|"find"|...):
    if counter >= 5: inject nudge
    if counter >= 8: inject hard stop

on tool_call("write"|"edit"|"bash"):
    reset counter to 0
```

**C. Patch Spiral Detector:**
- Tracks consecutive failed `edit` calls per file path
- At 4 failures: inject "STOP using patch. Rewrite the full file instead."
- At 6 total attempts: same injection (model spinning)

```
on tool_result for "edit":
    if failed:
        increment failureCount[filePath]
        if failureCount >= 4:
            inject correction
    if succeeded:
        decrement failureCount (punish less aggressively)

on turn_end:
    reset per-file counters (clean slate next turn)
```

**Extracted from SmallCode:**
- `src/governor/early_stop.js` — the full `EarlyStopDetector` class with all three detectors
- `bin/smallcode.js` — integration points where correction messages are injected

**Pi APIs used:**
- `pi.on("tool_call")` for counting read calls and intercepting before they run
- `pi.on("tool_result")` for tracking edit success/failure
- `pi.on("turn_end")` for resetting counters
- `pi.on("message_end")` for checking streaming output for repetition patterns
- `pi.sendMessage()` to inject correction messages

---

### 5. `plan-anchor.ts` — Numbered Plan Extraction + Progress Bar

**What it does:** For complex tasks, extracts a numbered plan from the LLM's first response, then re-injects the current step on every subsequent turn. This is the single biggest reliability improvement in SmallCode — it prevents the model from "forgetting" step 3 by the time it finishes step 1.

**Plan extraction (hybrid):**
1. Scan assistant message for numbered lists (regex: `\d+\.\s+.+`)
2. Use LLM-based extraction as fallback (via small model call to `classifyTaskType`)
3. Fall back to regex-only if LLM unavailable

**Plan anchor injection format:**
```
ACTIVE PLAN (step 2 of 4):
✓ 1. Read the existing auth module
→ 2. Add the refresh token handler
  3. Update the route middleware
  4. Run tests
```

**Dependency detection (pure code, zero LLM):**
- After plan extraction, check if any steps mention the same file path
- If step 2 and step 4 both mention `auth.js`, step 4 depends on step 2
- Kahn's topological sort produces parallel execution batches
- Structure: `{ batches: [{steps: [...]}, ...] }`

**Extracted from SmallCode:**
- `src/session/plan_tracker.js` — `PlanTracker` class with extract/advance/status
- `src/session/dependency_graph.js` — path-based dependency detection + Kahn's topological sort
- `bin/smallcode.js` — plan injection at `runAgentLoop`

**Pi APIs used:**
- `pi.on("turn_start")` — inject plan anchor before each LLM call
- `pi.on("context")` — add plan anchor to messages
- `pi.on("message_end")` — look for "[DONE]" markers and step completion language
- `pi.on("tool_result")` — detect step completion from tool success
- `pi.on("before_agent_start")` — inject plan mode instructions to system prompt

---

### 6. `error-diagnosis.ts` — Bash Failure Analysis

**What it does:** When a bash command exits non-zero, make a quick LLM call to classify the error (syntax|runtime|permission|notfound|timeout|unknown), locate the relevant file and line, and emit a one-line fix suggestion. The structured hint is prepended as `[ERROR-DIAGNOSIS]` to the tool result so the model has typed, located context.

**Triggered by: `tool_result` for `bash` with `isError: true`**

**Logic:**
1. Parse exit code and stderr
2. Make quick classifier call (tiny model or regex) to classify error type
3. Extract file path and line number from error output if present
4. Generate one-sentence fix suggestion
5. Prepend structured hint to result content

**Extracted from SmallCode:**
- `bin/features_adapter.js` — `diagnoseError()` function (Rank 4)
- `bin/executor.js` — the `[ERROR-DIAGNOSIS]` prepend logic

**Pi APIs used:**
- `pi.on("tool_result")` — intercept bash results with `isError`
- `pi.sendMessage()` / result mutation to prepend hint
- `ctx.ui.notify()` to surface diagnosis to user

---

### 7. `trust-decay.ts` — Per-Tool Trust Score Decay

**What it does:** Tracks consecutive failures per tool within a session. Tools that fail 3+ times in a row are soft-demoted (moved to end of tool list). Tools that fail 5+ times are dropped entirely from `pi.setActiveTools()` for the session. Prevents the model from looping on a broken MCP server or a search that keeps returning nothing.

**Logic:**
```
on tool_result:
    if isError:
        trust[toolName].consecutiveFailures++
        trust[toolName].totalCalls++
    else:
        trust[toolName].consecutiveFailures = 0  // reset on success

    if trust[toolName].consecutiveFailures >= 5:
        pi.setActiveTools(allTools minus this tool)
        ctx.ui.notify("Disabled tool: " + toolName + " (5 consecutive failures)")
    elif trust[toolName].consecutiveFailures >= 3:
        // Soft demotion: keep tool but note it's unreliable
        // Implemented via prompt injection: "[NOTE: {toolName} has failed 3 times]"
```

**Extracted from SmallCode:**
- `src/tools/trust_decay.js` — `TrustDecayTracker` with demote/drop logic
- `bin/governor.js` — `ToolScorer.shouldAvoid()` for the confidence calculation

**Pi APIs used:**
- `pi.on("tool_result")` — track success/failure
- `pi.setActiveTools()` — disable failing tools
- `pi.on("context")` — inject reliability notes for soft-demoted tools
- `pi.on("session_start")` — reset trust scores fresh

---

### 8. `adaptive-temp.ts` — Retry Temperature Variation

**What it does:** When the agent retries a failed edit, each attempt uses a different temperature so the model doesn't produce the same broken output three times. Attempt 1: lower temperature (deterministic fix). Attempt 2: raise temperature (explore alternatives). Attempt 3: return to base.

**Logic:**
```
on turn with retry attempt N (N > 0):
    temperature = baseTemp + delta * (attempt % 3)
    where delta alternates: -0.15, +0.15, 0
```

**Extracted from SmallCode:**
- `src/model/adaptive_temp.js` — `AdaptiveTemperature` class with attempt-based cycling
- Bin variable naming: `improvementAttempts[filePath]`

**Pi APIs used:**
- `pi.on("before_provider_request")` — override `event.payload.temperature`

---

### 9. `semantic-merge.ts` — Patch Recovery

**What it does:** When `edit` fails because the model's `old_str` no longer matches the current file content (which happens when previous edits shifted the file), asks a small LLM to merge the intended change into the current content and return the complete corrected file. This is the recovery path that makes patch-first editing viable.

**Triggered by:** `tool_result` for `edit` where `isError` and reason includes `old_str` not found.

**Logic:**
1. Extract the model's intended change (from tool input) and current file content
2. Make quick LLM call: "Merge this change into the current file"
3. Strip code fences from response
4. If content valid: write the merged file, return success result
5. If LLM unavailable or response empty: return original error

**Extracted from SmallCode:**
- `bin/features_adapter.js` — `semanticMerge()` function (Rank 7)
- `bin/executor.js` — the `case 'patch'` semantic merge fallback

**Pi APIs used:**
- `pi.on("tool_result")` — intercept failed edit results
- Result mutation to replace error with success

---

## Implementation Order (MVP → v1)

### MVP (Phase 1) — ~300 lines of TypeScript
The four highest-impact, lowest-complexity modules:

| Module | Lines | Complexity | Impact |
|---|---|---|---|
| Bootstrap Detector | ~80 | Low | Saves 3-5 tool calls on first turn |
| Read-Before-Write Guard | ~60 | Low | Prevents file corruption |
| Early-Stop (Read Loop + Patch Spiral) | ~100 | Medium | Prevents token waste spirals |
| Plan Anchor | ~80 | Medium | Biggest single reliability gain |

These four can be shipped as a single-file extension (~320 lines) in week 1.

### v1 (Phase 2) — ~600 lines of TypeScript
Add the remaining modules:

| Module | Lines | Notes |
|---|---|---|
| Error Diagnosis | ~60 | Depends on small LLM classifier call |
| Trust Decay | ~80 | Depends on `pi.setActiveTools()` |
| Adaptive Temp | ~40 | Depends on `before_provider_request` |
| Semantic Merge | ~80 | Depends on small LLM call |

### v2 (Phase 3) — Package polish
- Add unit tests
- Add SKILL.md so pi users can opt the LLM into descriptions of each feature
- npm publish or git tag for `pi install`
- Example .pi/settings.json snippet for project-local install

---

## Dependencies

```json
{
  "name": "@earendil-works/smallcode-harness",
  "keywords": ["pi-package"],
  "peerDependencies": {
    "@earendil-works/pi-ai": "*",
    "@earendil-works/pi-agent-core": "*",
    "@earendil-works/pi-coding-agent": "*",
    "@earendil-works/pi-tui": "*",
    "typebox": "*"
  },
  "pi": {
    "extensions": ["./src/index.ts"]
  }
}
```

No npm dependencies at runtime — all logic uses pi's built-in APIs and Node.js built-ins.

---

## Files Adapted from SmallCode

| SmallCode File | Adapted To | Adaptation |
|---|---|---|
| `bin/governor.js` (classifyTask, ToolScorer) | `src/trust-decay.ts` | Removed Bayesian scoring, kept consecutive-failure tracking |
| `src/governor/early_stop.js` | `src/early-stop.ts` | Same 3 detectors, adapted to pi event types |
| `src/tools/read_tracker.js` | `src/read-tracker.ts` | Same guard logic, adapted to pi's `tool_call` event |
| `src/session/bootstrap.js` | `src/bootstrap-detector.ts` | Same regex framework detection, but injects via `before_agent_start` |
| `src/session/plan_tracker.js` | `src/plan-anchor.ts` | Same numbered plan + anchor format, adapted to pi's `context` event |
| `src/session/dependency_graph.js` | `src/plan-anchor.ts` (inline) | Same Kahn's topological sort for parallel batch detection |
| `bin/features_adapter.js` (semanticMerge) | `src/semantic-merge.ts` | Same merge prompt + code fence stripping |
| `bin/features_adapter.js` (diagnoseError) | `src/error-diagnosis.ts` | Same bash error classifier format |
| `src/tools/trust_decay.js` | `src/trust-decay.ts` | Same demote/drop thresholds |
| `src/model/adaptive_temp.js` | `src/adaptive-temp.ts` | Same delta cycling formula |

---

## Risk & Mitigation

| Risk | Mitigation |
|---|---|
| Piperon conflicts — other extensions may also block/modify tool calls | Use `pi.setActiveTools()` leaf flag; document incompatibility patterns |
| Small LLM classifier calls add latency (~200-500ms) for error diagnosis / semantic merge | All optional — config flag to disable, falls back to pass-through |
| Plan anchoring conflicts with pi's existing plan mode | Detect pi's plan mode state; don't inject plan anchor if already in plan mode |
| Repetition detector triggers false positives on legitimate long repetitive output (data, logs) | Only check tail of buffer, not full output; minimum window size prevents data patterns |
| Read-before-write guard blocks legitimate new file creation | Always allows new files (doesn't exist yet); only blocks writes to existing files |
| Session persistence size grows unbounded | Cap state entries to 50; evict oldest; only store diffs, not full snapshots |

---

## Success Criteria

- **Bootstrap Detector:** First turn always includes `[PROJECT BOOTSTRAP]` with correct runtime/framework/test info
- **Read-Before-Write Guard:** 100% of first-attempt writes to unread existing files are blocked with hint
- **Early-Stop:** Read-loop nudge fires at 5 consecutive reads; hard stop at 8
- **Plan Anchor:** Every turn after plan extraction shows `ACTIVE PLAN (step X of Y)`
- **Trust Decay:** Tools with 5+ consecutive failures are removed from `setActiveTools`
- **Adaptive Temp:** Each retry attempt has different temperature (proven via log scrutiny)
- **All modules:** Gracefully degrade — never crash the agent loop
