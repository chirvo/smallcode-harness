/**
 * Early-Stop Detection — Degenerate Behavior Detection
 *
 * Three detectors that catch common small-model failure modes that waste tokens:
 *
 * A. Repetition Loop — Detects repeated output patterns in streaming text
 * B. Read-Only Loop — Detects endless read calls without producing output
 * C. Patch Spiral — Detects repeated failed edits on the same file
 *
 * Adapted from SmallCode's src/governor/early_stop.js
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";
import type { HarnessStateManager } from "./state.ts";

const ENV_KEY = "SMALLCODE_EARLY_STOP";
const READ_TOOLS = new Set(["read", "grep", "find", "ls", "search"]);

// ── Config ───────────────────────────────────────────────────────────────────
const REPETITION_THRESHOLD = 3;
const REPETITION_WINDOW_SIZES = [50, 80, 120];
const READ_LOOP_SOFT_NUDGE = 5;
const READ_LOOP_HARD_STOP = 8;
const PATCH_SPIRAL_FAIL_LIMIT = 4;
const PATCH_SPIRAL_ATTEMPT_LIMIT = 6;

// ── Repetition Loop Detector ─────────────────────────────────────────────────

export function checkRepetition(buffer: string): string | null {
  if (buffer.length < 200) return null;

  const tail = buffer.slice(-200);

  for (const windowSize of REPETITION_WINDOW_SIZES) {
    if (tail.length < windowSize * REPETITION_THRESHOLD) continue;

    const pattern = tail.slice(-windowSize);
    let count = 0;
    let searchFrom = 0;

    while (true) {
      const idx = tail.indexOf(pattern, searchFrom);
      if (idx === -1) break;
      count++;
      searchFrom = idx + 1;
      if (count >= REPETITION_THRESHOLD) break;
    }

    if (count >= REPETITION_THRESHOLD) {
      return `[SYSTEM] You are repeating the same output (${windowSize}-char pattern seen ${count}x). STOP. Take a different approach or state what is blocking you.`;
    }
  }

  return null;
}

// ── Greeting Regression Detector ─────────────────────────────────────────────

const GREETING_PATTERNS = [
  "how can i help",
  "what would you like",
  "what can i do for you",
  "how can i assist",
  "hello! i'm ready",
  "hi there! what",
];

export function checkGreeting(content: string, hasToolCalls: boolean): string | null {
  if (!hasToolCalls) return null;
  const lc = content.toLowerCase();
  if (GREETING_PATTERNS.some((p) => lc.includes(p))) {
    return "[SYSTEM] You output a greeting instead of completing the task. Continue where you left off. Do NOT restart the conversation.";
  }
  return null;
}

// ── Registration ─────────────────────────────────────────────────────────────

export function registerEarlyStop(pi: ExtensionAPI, state: HarnessStateManager): void {
  const enabled = process.env[ENV_KEY] !== "false";
  if (!enabled) return;

  // Track read-only calls and detect loops
  pi.on("tool_call", (event, _ctx: ExtensionContext) => {
    const toolName = event.toolName;

    // Read tools
    if (READ_TOOLS.has(toolName)) {
      // If model has written anything recently, reading is fine — reset streak
      const streak = state.getReadStreak();
      if (streak === 0) {
        // First read — just track it
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

    // Non-read tool (write, edit, bash) — reset read streak and patch counters
    state.resetReadStreak();
  });

  // Track patch results for spiral detection
  pi.on("tool_result", (event, _ctx: ExtensionContext) => {
    // Use type-safe check: edit tool is "name" not toolCallId typed
    const toolName = event.toolName;

    if (toolName === "edit") {
      const path = (event.input as Record<string, unknown>)?.path as string | undefined;
      if (!path) return;

      if (!event.isError) {
        // Successful patch — reduce failure count
        state.recordPatchSuccess(path);
        return;
      }

      // Failed patch
      const failCount = state.recordPatchFailure(path);
      const attemptCount = state.getPatchAttempts(path);

      if (failCount >= PATCH_SPIRAL_FAIL_LIMIT || attemptCount >= PATCH_SPIRAL_ATTEMPT_LIMIT) {
        const msg = `[SYSTEM] You have attempted to patch "${path}" ${attemptCount} times (${failCount} failures). STOP using patch. Instead:
1. Use read to see the current state
2. Decide what the ENTIRE file should contain
3. Use write to rewrite it completely from scratch
Do NOT attempt another patch on this file.`;

        pi.sendMessage({
          customType: "sc-harness-correction",
          content: msg,
          display: true,
        });
      }
    }
  });

  // Detect repetition in streaming output
  pi.on("message_end", (event, _ctx: ExtensionContext) => {
    if (event.message.role !== "assistant") return;
    const content = extractText(event.message);
    if (!content) return;

    const hasToolCalls = Array.isArray((event.message as unknown as Record<string, unknown>).tool_calls);

    // Check greeting regression
    const greetingInjection = checkGreeting(content, hasToolCalls);
    if (greetingInjection) {
      pi.sendMessage({
        customType: "sc-harness-correction",
        content: greetingInjection,
        display: true,
      });
      return;
    }

    // Check repetition (only for non-tool responses)
    if (!hasToolCalls) {
      const repetitionInjection = checkRepetition(content);
      if (repetitionInjection) {
        pi.sendMessage({
          customType: "sc-harness-correction",
          content: repetitionInjection,
          display: true,
        });
      }
    }
  });

  // Reset per-turn counters on turn end
  pi.on("turn_end", (_event, _ctx: ExtensionContext) => {
    state.newTurn();
  });
}

function extractText(message: { content?: unknown }): string | null {
  const content = message.content;
  if (!content) return null;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((block: { type?: string; text?: string }) => block.type === "text")
      .map((block: { text?: string }) => block.text || "")
      .join("\n");
  }
  return null;
}
