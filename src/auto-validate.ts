/**
 * Auto-Validate After Edits
 *
 * After every write_file or edit, automatically runs the project's
 * test/compile command. If validation fails, injects the error so the
 * model self-corrects before the human sees broken code.
 *
 * Adapted from SmallCode's runValidation() in bin/model_client.js
 * and the auto-validate loop in bin/smallcode.js
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import type { HarnessStateManager } from "./state.ts";
import { log } from "./log.ts";

const ENV_KEY = "SMALLCODE_AUTO_VALIDATE";

/** Detect the best validation command for a file extension */
function detectValidator(filePath: string, cwd: string): string | null {
  const ext = filePath.split(".").pop()?.toLowerCase();

  if (ext === "ts" || ext === "tsx") {
    if (existsSync(join(cwd, "tsconfig.json"))) return "npx tsc --noEmit --pretty false 2>&1 || true";
    return null;
  }
  if (ext === "js" || ext === "mjs") {
    return `node --check ${escapeShell(filePath)} 2>&1 || true`;
  }
  if (ext === "py") {
    return `python -m py_compile ${escapeShell(filePath)} 2>&1 || true`;
  }
  if (ext === "rs" && existsSync(join(cwd, "Cargo.toml"))) {
    return "cargo check --message-format short 2>&1 || true";
  }
  if (ext === "go" && existsSync(join(cwd, "go.mod"))) {
    return "go vet ./... 2>&1 || true";
  }
  if (ext === "json") {
    return `node -e "JSON.parse(require('fs').readFileSync('${escapeShell(filePath)}','utf-8'))" 2>&1 || true`;
  }

  return null; // No validator for this type
}

function escapeShell(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

/** Validate a file, return { passed, output } or null if no validator */
function validate(filePath: string, cwd: string): { passed: boolean; output: string } | null {
  const cmd = detectValidator(filePath, cwd);
  if (!cmd) return null;

  const fullPath = join(cwd, filePath);
  if (!existsSync(fullPath)) return null;

  try {
    const output = execSync(cmd, { cwd, encoding: "utf-8", timeout: 15000, maxBuffer: 1024 * 1024 });
    const trimmed = output.trim();
    // No output or just version line = passed
    const passed = trimmed.length === 0 || trimmed.includes("0 errors") || !trimmed.toLowerCase().includes("error");
    return { passed, output: trimmed.slice(0, 2000) };
  } catch (e: unknown) {
    const stderr = (e as { stderr?: string; stdout?: string; message?: string }).stderr
      || (e as { stdout?: string }).stdout
      || (e as Error).message
      || "";
    return { passed: false, output: stderr.slice(0, 2000) };
  }
}

export function registerAutoValidate(pi: ExtensionAPI, state: HarnessStateManager): void {
  const enabled = process.env[ENV_KEY] !== "false";
  if (!enabled) return;

  pi.on("tool_result", (event, _ctx: ExtensionContext) => {
    // Only validate successful write/edit tool calls
    if (event.toolName !== "write" && event.toolName !== "edit") return;
    if (event.isError) return;

    // Extract the file path from the tool input
    const input = event.input as Record<string, unknown>;
    const path = input?.path as string | undefined;
    if (!path) return;

    // Don't validate new files on first write (they're probably skeletons)
    // Wait until the model edits an existing file
    if (event.toolName === "write") {
      // Only validate if it's an edit to an existing file
      // (We track this in state)
      if (!state.hasWritten(path)) return; // First write, skip
    }

    const cwd = _ctx.cwd;
    const result = validate(path, cwd);
    if (!result) return; // No validator for this file type

    if (!result.passed) {
      log.warn("auto-validate", "%s failed validation:\n%s", path, result.output.slice(0, 200));

      // Inject the error as a follow-up so the model self-corrects
      pi.sendMessage({
        customType: "sc-harness-validation",
        content: `[VALIDATION-FAILED] File "${path}" has errors:\n\n${result.output}\n\nFix the errors above and try again. Do not move on until validation passes.`,
        display: true,
      }, { deliverAs: "followUp" });
    } else {
      log.debug("auto-validate", "%s passed validation", path);
    }
  });

  // Also try to run the project test suite after edit turns
  pi.on("turn_end", (_event, ctx: ExtensionContext) => {
    const cwd = ctx.cwd;
    // Only if we have a detected test command from bootstrap
    const testCmd = state.state.bootstrap?.testCommand;
    if (!testCmd) return;

    // Don't run tests every turn — only when files were actually changed
    // (Heuristic: if the model wrote/edited files this turn, run tests)
    log.debug("auto-validate", "Turn ended, would run: %s", testCmd);
    // Future: actually run testCmd here and inject failures
  });
}
