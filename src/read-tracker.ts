/**
 * Read-Before-Write Guard + Read-Loop Detection
 *
 * SINGLE tool_call handler to avoid multi-handler race conditions in pi.
 * Handles: read tracking, write guard, and read-only loop detection.
 *
 * Adapted from SmallCode's src/tools/read_tracker.js + src/governor/early_stop.js
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { HarnessStateManager } from "./state.ts";

const ENV_KEY = "SMALLCODE_WRITE_GUARD";
const READ_TOOLS = new Set(["read", "grep", "find", "ls", "search"]);
const READ_LOOP_SOFT_NUDGE = 5;
const READ_LOOP_HARD_STOP = 8;

export function registerReadTracker(pi: ExtensionAPI, state: HarnessStateManager): void {
  const enabled = process.env[ENV_KEY] !== "false";
  if (!enabled) return;

  // SINGLE handler for all tool_call events.
  // Multiple pi.on("tool_call", ...) registrations can cause conflicts where
  // one handler's { block: true } result is discarded in favor of another's
  // undefined return. Everything in one handler avoids this.
  pi.on("tool_call", (event, ctx: ExtensionContext) => {
    const tool = event.toolName as string;
    const input = event.input as Record<string, unknown>;
    const path = input?.path as string | undefined;

    // ── Read tracking + read-loop detection ──────────────────────────────
    if (READ_TOOLS.has(tool)) {
      // Track file read
      if (tool === "read" && typeof path === "string") {
        state.recordRead(path);
      }

      // Read-loop detection
      const streak = state.getReadStreak();
      if (streak === 0) {
        state.incrementReadStreak();
      } else {
        const newStreak = state.incrementReadStreak();

        // Soft nudge at 5
        if (newStreak === READ_LOOP_SOFT_NUDGE) {
          pi.sendMessage({
            customType: "sc-harness-correction",
            content: "[SYSTEM] You have read 5 files/results. You likely have enough context. After your next read (if needed), write your findings immediately — don't keep reading.",
            display: true,
          });
        }

        // Hard stop at 8
        if (newStreak >= READ_LOOP_HARD_STOP) {
          pi.sendMessage({
            customType: "sc-harness-correction",
            content: "[SYSTEM] You have read 8 results without producing output. STOP reading and START writing now. If you need one more specific thing, get it — then write your response immediately.",
            display: true,
          });
          state.resetReadStreak();
        }
      }
      return;
    }

    // ── Non-read tools reset the read streak ─────────────────────────────
    if (tool === "write" || tool === "edit" || tool === "bash") {
      state.resetReadStreak();
    }

    // ── Write guard ──────────────────────────────────────────────────────
    if (tool === "write" || tool === "edit") {
      if (!path || typeof path !== "string") return;

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
