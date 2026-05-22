# SmallCode Harness Skill

When the `@earendil-works/smallcode-harness` extension is active, the following
compensations are in effect for small local models (8B-35B):

## Active Features

1. **Bootstrap Detection** — A `[PROJECT BOOTSTRAP]` block appears on the first
   turn showing the detected runtime (node/python/rust/go/ruby), framework
   (Next.js/FastAPI/Django/React/Vue/Rails), package manager, test command, and
   run/build commands. Use this context to avoid wasting tool calls discovering
   the project structure.

2. **Read-Before-Write Guard** — If you attempt to write/edit a file you haven't
   read this session, the tool call is blocked with a hint to read first. Retry
   to force the write. This prevents overwriting files with incorrect content.

3. **Early-Stop Detection** — Three behavioral detectors inject corrections when
   you get stuck:
   - **Read loop**: After 5 consecutive reads without writing, you get a soft
     nudge. At 8, a hard stop injects "STOP reading and START writing."
   - **Patch spiral**: After 4+ failed edits on the same file, you're told to
     use write instead of patch.
   - **Greeting regression**: If you output a greeting mid-task (lost context),
     a correction re-injects the task.

4. **Plan Anchor** — For multi-step tasks, your first assistant response with a
   numbered plan (e.g., "1. Read file, 2. Implement X, 3. Run tests") gets
   extracted. A progress bar is injected into every subsequent turn showing
   which steps are done and which is active.

5. **Error Diagnosis** — When a bash command fails, a `[ERROR-DIAGNOSIS]` line
   is prepended to the output with the error type, file/line, and a one-line fix
   suggestion.

6. **Trust Decay** — Tools that fail 5+ times consecutively are disabled for
   the session. Use `/tools` to re-enable. Prompts warn about tools that fail
   3+ times.

7. **Adaptive Temperature** — Retry attempts use different temperatures so you
   don't produce the same broken output three times. Attempt 1: colder (fix),
   attempt 2: hotter (explore), attempt 3: baseline.

8. **Semantic Merge** — When edit fails because `old_str` doesn't match (file
   was already modified by previous edits), a fuzzy merge attempts to find and
   replace the right location. If that fails, a notification suggests using
   write instead.

## Env Config

Each feature is independently toggleable via env vars prefixed with
`SMALLCODE_` (see README.md).
