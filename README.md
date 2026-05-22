# SmallCode Harness

**Small-model compensations for pi.** Ported from [SmallCode](https://github.com/Doorman11991/smallcode)'s architecture — the terminal coding agent optimized for 8B-35B local LLMs.

Pi assumes frontier models with 128k+ context and reliable tool calling. This package brings SmallCode's compensatory patterns to pi users running local models.

## Features

| Module | What it does |
|---|---|
| **Bootstrap Detector** | Auto-classifies project on session start (runtime, framework, test command) — saves 3-5 tool calls |
| **Read-Before-Write Guard** | Blocks writes to unread existing files — prevents overwrite corruption |
| **Early-Stop Detection** | Catches repetition loops, endless read loops, and patch spirals — saves tokens |
| **Plan Anchor** | Extracts numbered plans, re-injects progress bar every turn — prevents drift |
| **Error Diagnosis** | Bash failures → structured fix hint with file/line/suggestion |
| **Trust Decay** | Disables tools after 5 consecutive failures — prevents looping |
| **Adaptive Temperature** | Varies retry temperature so each attempt doesn't produce the same broken output |
| **Semantic Merge** | Recovers when edit `old_str` doesn't match — merges intended change |

## Install

```bash
pi install git:github.com/chirvo/smallcode-harness
```

Or add to your project's `.pi/settings.json`:

```json
{
  "packages": ["git:github.com/chirvo/smallcode-harness"]
}
```

## Usage

Once installed, the extension activates automatically on session start for any project. No manual commands needed.

## Configuration

Each module is independently toggleable via environment variables:

| Env var | Default | Description |
|---|---|---|
| `SMALLCODE_BOOTSTRAP` | `true` | Enable project bootstrap detection |
| `SMALLCODE_WRITE_GUARD` | `true` | Enable read-before-write guard |
| `SMALLCODE_EARLY_STOP` | `true` | Enable repetition/read-loop/patch-spiral detection |
| `SMALLCODE_PLAN_ANCHOR` | `true` | Enable plan extraction + progress anchor |
| `SMALLCODE_ERROR_DIAG` | `true` | Enable bash error diagnosis |
| `SMALLCODE_TRUST_DECAY` | `true` | Enable per-tool trust score decay |
| `SMALLCODE_ADAPTIVE_TEMP` | `true` | Enable adaptive retry temperature |
| `SMALLCODE_SEMANTIC_MERGE` | `true` | Enable patch semantic merge recovery |

## Credits

Architecture ported from [SmallCode](https://github.com/Doorman11991/smallcode) by Doorman11991 — a genuinely well-engineered coding agent for small LLMs.
