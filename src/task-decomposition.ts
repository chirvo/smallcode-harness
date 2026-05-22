/**
 * Task Decomposition — When a Task Keeps Failing, Break It Down
 *
 * When the same file fails validation 2+ times in a row, suggests a
 * decomposition strategy: split the file, fix one error at a time, rewrite
 * the section from scratch, or extract a function.
 *
 * Small models can't fix 5 compilation errors in one pass. Decomposition
 * lets them tackle one problem at a time.
 *
 * Adapted from SmallCode's bin/features_adapter.js (decomposeTask, Rank 5)
 * and bin/governor.js (pickDecomposeStrategy)
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { HarnessStateManager } from "./state.ts";
import { log } from "./log.ts";

const ENV_KEY = "SMALLCODE_DECOMPOSE";

interface DecomposeResult {
  strategy: string;
  instruction: string;
}

const VALID_STRATEGIES = ["split_file", "one_error_at_a_time", "rewrite_section", "extract_function"] as const;

function pickDecomposeStrategy(content: string, errors: string, filePath: string): DecomposeResult {
  const lines = content.split("\n").length;
  const errorCount = errors.split("error").length - 1;

  // Strategy 1: File is too big — split into smaller files
  if (lines > 80) {
    return {
      strategy: "split_file",
      instruction: `The file ${filePath} is too complex to fix in one go (${lines} lines, ${errorCount} errors). Split it: extract working parts into separate files, then fix the broken parts in isolation.`,
    };
  }

  // Strategy 2: Multiple unrelated errors — fix one at a time
  if (errorCount > 1) {
    const firstError = errors.split("\n").find((l) => l.includes("error")) || errors.slice(0, 100);
    return {
      strategy: "one_error_at_a_time",
      instruction: `Found ${errorCount} errors. Fix ONE error only:\n\n${firstError}\n\nFix ONLY this one error. Don't touch anything else. After this is fixed, move to the next one.`,
    };
  }

  // Strategy 3: Single persistent error — try different approach
  return {
    strategy: "rewrite_section",
    instruction: `The fix attempts aren't working. Try a completely different approach:\n1. Delete the broken section entirely\n2. Rewrite it from scratch using a simpler implementation\n3. Don't copy the old logic — start fresh\n\nError that won't go away: ${errors.slice(0, 150)}`,
  };
}

export function registerTaskDecomposition(pi: ExtensionAPI, state: HarnessStateManager): void {
  const enabled = process.env[ENV_KEY] !== "false";
  if (!enabled) return;

  // Track consecutive failures per file
  const failureCount: Record<string, number> = {};

  pi.on("turn_start", () => {
    // Keep failure counts across retries within a session,
    // but don't carry them across turns
  });

  pi.on("tool_result", (event, _ctx: ExtensionContext) => {
    if (event.toolName !== "edit") return;
    if (!event.isError) {
      // Success — reset failure count for this file
      const input = event.input as Record<string, unknown>;
      const path = input?.path as string | undefined;
      if (path) failureCount[path] = 0;
      return;
    }

    const input = event.input as Record<string, unknown>;
    const path = input?.path as string | undefined;
    const oldStr = input?.old_str as string | undefined;
    const newStr = input?.new_str as string | undefined;
    if (!path) return;

    // Increment failure count
    failureCount[path] = (failureCount[path] || 0) + 1;

    // Only decompose after 2+ consecutive failures on the same file
    if (failureCount[path] < 2) return;

    // Build context for decomposition
    const content = [oldStr || "", newStr || ""].join("\n");
    const errors = extractErrorText(event);
    const strategy = pickDecomposeStrategy(content, errors, path);

    log.warn("task-decomposition", "Decomposing %s after %d failures → %s", path, failureCount[path], strategy.strategy);

    // Reset count so we don't keep decomposing the same file
    failureCount[path] = 0;

    // Inject the decomposition as a system message
    pi.sendMessage({
      customType: "sc-harness-decompose",
      content: `[DECOMPOSE] Task stuck on "${path}" after multiple attempts. Try this strategy:\n\nStrategy: ${strategy.strategy}\n\n${strategy.instruction}`,
      display: true,
    }, { deliverAs: "followUp" });
  });
}

function extractErrorText(event: { content?: unknown }): string {
  const content = event.content;
  if (typeof content === "string") return content.slice(0, 500);
  if (Array.isArray(content)) {
    return content
      .filter((c: { type?: string; text?: string }) => c.type === "text")
      .map((c: { text?: string }) => c.text || "")
      .join("\n")
      .slice(0, 500);
  }
  return "";
}
