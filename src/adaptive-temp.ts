/**
 * Adaptive Temperature — Retry Temperature Variation
 *
 * When the agent retries a failed edit, each attempt uses a different temperature
 * so the model doesn't produce the same broken output three times.
 * Attempt 1: lower temperature (deterministic fix)
 * Attempt 2: raise temperature (explore alternatives)
 * Attempt 3: return to base
 *
 * Adapted from SmallCode's src/model/adaptive_temp.js
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { HarnessStateManager } from "./state.ts";

const ENV_KEY = "SMALLCODE_ADAPTIVE_TEMP";
const TEMP_DELTA = 0.15;

export function registerAdaptiveTemp(pi: ExtensionAPI, state: HarnessStateManager): void {
  const enabled = process.env[ENV_KEY] !== "false";
  if (!enabled) return;

  // Track improvement attempts per file
  pi.on("tool_call", (event, _ctx: ExtensionContext) => {
    if (event.toolName !== "edit") return;

    const input = event.input as { path?: string } | undefined;
    const path = input?.path;
    if (!path) return;

    state.incrementImprovementAttempts(path);
  });

  // Override temperature on retry
  pi.on("before_provider_request", (event, _ctx: ExtensionContext) => {
    // Find the file being edited in the current conversation context
    // by checking the tool_call inputs in the payload
    const payload = event.payload as Record<string, unknown>;
    const messages = payload.messages as Array<Record<string, unknown>> | undefined;
    if (!messages) return;

    // Count edit attempts for this turn by looking at recent messages
    let editCount = 0;
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role === "assistant" && Array.isArray(msg.tool_calls)) {
        for (const tc of msg.tool_calls as Array<{ function?: { name?: string } }>) {
          if (tc.function?.name === "edit") {
            editCount++;
          }
        }
      }
      // Don't go back past the user message
      if (msg.role === "user") break;
    }

    if (editCount === 0) return;

    // Attempt 1 (index 0): lower temp (more deterministic)
    // Attempt 2 (index 1): raise temp (explore alternatives)
    // Attempt 3 (index 2): base temp
    const deltas = [ -TEMP_DELTA, TEMP_DELTA, 0 ];
    const idx = (editCount - 1) % deltas.length;
    const delta = deltas[idx];

    const currentTemp = (payload.temperature as number) ?? 0.1;
    const newTemp = Math.max(0, Math.min(2, currentTemp + delta));

    return {
      ...payload,
      temperature: newTemp,
    } as Record<string, unknown>;
  });
}
