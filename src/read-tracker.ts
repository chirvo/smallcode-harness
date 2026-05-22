/**
 * Read-Before-Write Guard
 *
 * Small models regularly overwrite files with incorrect content when they
 * haven't internalized what's already there. This guard tracks which paths the
 * model has read this session. First write to an unread existing file is refused
 * with a hint. Second attempt is allowed (legitimate full-replace intent).
 *
 * Adapted from SmallCode's src/tools/read_tracker.js + bin/executor.js
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { HarnessStateManager } from "./state.ts";

const ENV_KEY = "SMALLCODE_WRITE_GUARD";

export function registerReadTracker(pi: ExtensionAPI, state: HarnessStateManager): void {
  const enabled = process.env[ENV_KEY] !== "false";
  if (!enabled) return;

  // Track reads
  pi.on("tool_call", (event, _ctx: ExtensionContext) => {
    if (isToolCallEventType("read", event)) {
      const path = event.input.path;
      if (typeof path === "string") {
        state.recordRead(path);
      }
    }
  });

  // Guard writes to unread files
  pi.on("tool_call", (event, ctx: ExtensionContext) => {
    if (isToolCallEventType("write", event) || isToolCallEventType("edit", event)) {
      const path = event.input.path as string | undefined;
      if (!path || typeof path !== "string") return;

      // Resolve relative to cwd
      const fullPath = resolve(ctx.cwd, path);

      // New files are always allowed
      if (!existsSync(fullPath)) {
        state.recordWrite(path);
        return;
      }

      // If already written (second attempt), allow
      if (state.hasWritten(path)) return;

      // Already read — allow
      if (state.hasRead(path)) return;

      // First write to unread existing file — block with hint
      state.recordWrite(path); // Mark so second attempt goes through
      return { block: true, reason: `File "${path}" not read. Use read first to understand content, or retry to force overwrite.` };
    }
  });
}
