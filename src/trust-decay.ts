/**
 * Trust Decay — Per-Tool Consecutive-Failure Tracking
 *
 * Tracks consecutive failures per tool within a session. Tools that fail 3+
 * times in a row are soft-demoted (prompt notes their unreliability). Tools
 * that fail 5+ times are dropped from pi.setActiveTools() for the session.
 *
 * Prevents the model from looping on a broken MCP server or a search that
 * keeps returning nothing.
 *
 * Adapted from SmallCode's src/tools/trust_decay.js + bin/governor.js
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { HarnessStateManager } from "./state.ts";

const ENV_KEY = "SMALLCODE_TRUST_DECAY";
const SOFT_DEMOTE_THRESHOLD = 3;
const HARD_DROP_THRESHOLD = 5;

export function registerTrustDecay(pi: ExtensionAPI, state: HarnessStateManager): void {
  const enabled = process.env[ENV_KEY] !== "false";
  if (!enabled) return;

  // Track tool results
  pi.on("tool_result", (event, ctx: ExtensionContext) => {
    const toolName = event.toolName;

    if (event.isError) {
      const failures = state.recordToolFailure(toolName);

      // Hard drop at 5
      if (failures >= HARD_DROP_THRESHOLD) {
        // Get current active tools and remove this one
        const active = pi.getActiveTools();
        const filtered = active.filter((t) => t !== toolName);

        if (filtered.length < active.length) {
          pi.setActiveTools(filtered);
          ctx.ui.notify(
            `Disabled tool "${toolName}" (${failures} consecutive failures). Use /tools to re-enable.`,
            "warning",
          );
        }
      }
    } else {
      state.recordToolSuccess(toolName);
    }
  });

  // Inject reliability notes for soft-demoted tools
  pi.on("context", (event, _ctx: ExtensionContext) => {
    const notes: string[] = [];

    for (const [toolName, trust] of Object.entries(state.state.toolTrust)) {
      if (trust.consecutiveFailures >= SOFT_DEMOTE_THRESHOLD && trust.consecutiveFailures < HARD_DROP_THRESHOLD) {
        notes.push(`[NOTE: "${toolName}" has failed ${trust.consecutiveFailures}x — verify its output carefully]`);
      }
    }

    if (notes.length > 0) {
      const noteText = notes.join("\n");
      event.messages.push({
        role: "user" as const,
        content: [{ type: "text" as const, text: noteText }],
        timestamp: Date.now(),
      });
    }
  });

  // Reset trust scores on new session (tools may have been fixed)
  pi.on("session_start", (_event, _ctx: ExtensionContext) => {
    state.state.toolTrust = {};
    state.flush();
  });
}
