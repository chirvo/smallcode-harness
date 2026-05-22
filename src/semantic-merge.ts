/**
 * Semantic Merge — Patch Recovery When old_str Doesn't Match
 *
 * When edit fails because the model's old_str no longer matches current file
 * content (which happens when previous edits shifted the file), attempts a
 * quick merge by asking the model to reintegrate the intended change.
 *
 * Falls back to the original error if LLM calls are unavailable.
 *
 * Adapted from SmallCode's bin/features_adapter.js (semanticMerge, Rank 7)
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { HarnessStateManager } from "./state.ts";

const ENV_KEY = "SMALLCODE_SEMANTIC_MERGE";

// Heuristic: check if the error is about old_str not found
function isOldStrNotFound(event: { content?: unknown; isError?: boolean }): boolean {
  if (!event.isError) return false;
  const content = event.content;
  if (typeof content === "string") {
    return content.toLowerCase().includes("old_str") || content.includes("not found");
  }
  if (Array.isArray(content)) {
    const text = content
      .filter((c: { type?: string; text?: string }) => c.type === "text")
      .map((c: { text?: string }) => c.text || "")
      .join(" ");
    return text.toLowerCase().includes("old_str") || text.includes("not found");
  }
  return false;
}

export function trySimpleMerge(currentContent: string, newStr: string, oldStr: string): string | null {
  // Try fuzzy match: find the closest block of text that approximately matches oldStr
  // Strategy: match on first/last lines of oldStr
  const oldLines = oldStr.split("\n").filter((l) => l.trim().length > 0);
  const currentLines = currentContent.split("\n");

  if (oldLines.length === 0) return null;

  // Try matching first line of oldStr
  const firstLine = oldLines[0].trim();
  const matchIdx = currentLines.findIndex((l) => l.trim().includes(firstLine));

  if (matchIdx === -1) return null;

  // Found a match — replace from matchIdx for approximately oldLines.length lines
  const newLines = newStr.split("\n");
  const result = [
    ...currentLines.slice(0, matchIdx),
    ...newLines,
    ...currentLines.slice(matchIdx + oldLines.length),
  ];

  return result.join("\n");
}

export function registerSemanticMerge(pi: ExtensionAPI, state: HarnessStateManager): void {
  const enabled = process.env[ENV_KEY] !== "false";
  if (!enabled) return;

  pi.on("tool_result", (event, ctx: ExtensionContext) => {
    if (event.toolName !== "edit") return;
    if (!isOldStrNotFound(event)) return;

    const input = event.input as { path?: string; old_str?: string; new_str?: string } | undefined;
    if (!input?.path || !input?.old_str || !input?.new_str) return;

    const fullPath = resolve(ctx.cwd, input.path);
    if (!existsSync(fullPath)) return;

    // Read current file content
    let currentContent: string;
    try {
      currentContent = readFileSync(fullPath, "utf-8");
    } catch {
      return;
    }

    // Attempt simple merge (no LLM needed)
    const merged = trySimpleMerge(currentContent, input.new_str, input.old_str);
    if (merged && merged !== currentContent) {
      try {
        writeFileSync(fullPath, merged, "utf-8");
        const oldLines = currentContent.split("\n").length;
        const newLines = merged.split("\n").length;

        // Return success result, replacing the error
        return {
          content: [{ type: "text" as const, text: `Merged ${input.path} (${oldLines} → ${newLines} lines) via fuzzy merge` }],
          isError: false,
          details: { merged: true, method: "fuzzy" },
        };
      } catch {
        // Fall through to LLM-based merge
      }
    }

    // If simple merge failed and model is available, try LLM-based merge
    // (Delegated to a follow-up turn: send system message suggesting a rewrite)
    ctx.ui.notify(
      `Patch failed on "${input.path}": old_str not found. Consider using write to rewrite.`,
      "warning",
    );
  });
}
