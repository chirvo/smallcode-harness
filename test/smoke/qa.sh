#!/usr/bin/env bash
set -euo pipefail
# E2E smoke test — automates the manual QA checklist
#
# Creates a temp project, installs the extension, and verifies each feature
# produces expected output by running pi in print mode.
#
# Usage:
#   bash test/smoke/qa.sh
#   SMALLCODE_MODEL=qwen3:8b bash test/smoke/qa.sh

EXTENSION_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

MODEL="${SMALLCODE_MODEL:-qwen3:8b}"
BASE_URL="${SMALLCODE_BASE_URL:-http://localhost:11434/v1}"
PASS=0
FAIL=0

green() { printf "\033[32m%s\033[0m\n" "$1"; }
red()   { printf "\033[31m%s\033[0m\n" "$1"; }
bold()  { printf "\033[1m%s\033[0m\n" "$1"; }

check() {
  local label="$1" expected="$2" actual="$3"
  if echo "$actual" | grep -qF "$expected"; then
    green "  ✓ $label"
    ((PASS++))
  else
    red "  ✗ $label (expected substring: '$expected')"
    echo "    got: $(echo "$actual" | head -c 200)"
    ((FAIL++))
  fi
}

bold "=== SmallCode Harness E2E Smoke Test ==="
bold "Model: $MODEL"
bold "Workdir: $WORKDIR"
echo ""

# ── Setup test project ────────────────────────────────────────────────────────
mkdir -p "$WORKDIR/.pi"
cat > "$WORKDIR/.pi/settings.json" <<JSON
{ "packages": ["$EXTENSION_DIR"] }
JSON
cat > "$WORKDIR/package.json" <<JSON
{ "name": "qa-test", "dependencies": { "express": "^4" } }
JSON
cat > "$WORKDIR/index.js" <<JS
const express = require("express");
const app = express();
app.get("/", (req, res) => res.send("ok"));
module.exports = app;
JS

cd "$WORKDIR"

# ── Test 1: Bootstrap detection ──────────────────────────────────────────────
bold "[Test 1] Bootstrap detection"
OUT=$(pi --model "$MODEL" --endpoint "$BASE_URL" --print \
  "what runtime and framework did you detect?" 2>/dev/null || true)
check "Shows runtime" "node" "$OUT"
check "Shows package manager" "npm" "$OUT"
check "Shows framework" "Express" "$OUT"

# ── Test 2: Read-before-write guard ──────────────────────────────────────────
bold "[Test 2] Read-before-write guard"
OUT=$(pi --model "$MODEL" --endpoint "$BASE_URL" --print \
  "overwrite package.json with {\"name\":\"crash\"}" 2>/dev/null || true)
check "Blocks write to unread file" "not read" "$OUT"

# ── Test 3: Error diagnosis ──────────────────────────────────────────────────
bold "[Test 3] Error diagnosis"
OUT=$(pi --model "$MODEL" --endpoint "$BASE_URL" --print \
  "run bogus-command-12345" 2>/dev/null || true)
check "Shows ERROR-DIAGNOSIS tag" "ERROR-DIAGNOSIS" "$OUT"
check "Identifies type" "notfound" "$OUT"

# ── Test 4: Plan anchor ──────────────────────────────────────────────────────
bold "[Test 4] Plan anchor"
OUT=$(pi --model "$MODEL" --endpoint "$BASE_URL" --print \
  "create a REST API with 1. a GET route 2. a POST route 3. error handling 4. tests" 2>/dev/null || true)
check "Shows ACTIVE PLAN header" "ACTIVE PLAN" "$OUT"

# ── Summary ──────────────────────────────────────────────────────────────────
echo ""
bold "=== Results ==="
green "$PASS passed"
if [ "$FAIL" -gt 0 ]; then
  red "$FAIL failed"
  exit 1
fi
