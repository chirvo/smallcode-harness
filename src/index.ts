/**
 * SmallCode Harness — Pi Extension Entry Point
 *
 * Ports SmallCode's small-model compensatory patterns into pi's extension system.
 * Each module is independently toggleable via env vars and gracefully degrades.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { HarnessStateManager } from "./state.ts";
import { registerBootstrapDetector } from "./bootstrap-detector.ts";
import { registerReadTracker } from "./read-tracker.ts";
import { registerEarlyStop } from "./early-stop.ts";
import { registerPlanAnchor } from "./plan-anchor.ts";
import { registerErrorDiagnosis } from "./error-diagnosis.ts";
import { registerTrustDecay } from "./trust-decay.ts";
import { registerAdaptiveTemp } from "./adaptive-temp.ts";
import { registerSemanticMerge } from "./semantic-merge.ts";
import { setLogDir, log } from "./log.ts";

export default function (pi: ExtensionAPI): void {
  // ── Shared state ──────────────────────────────────────────────────────────
  const state = new HarnessStateManager(pi);

  // Initialize logging to the project's .smallcode/ dir
  pi.on("session_start", (_event, ctx: ExtensionContext) => {
    setLogDir(ctx.cwd + "/.smallcode");
  });

  // ── Module registration (env-gated, all gracefully degrade) ───────────────
  // Each module is wrapped in try/catch so one bad handler doesn't crash the
  // entire extension. Errors are logged to .smallcode/sc-harness.log.

  const modules = [
    ["bootstrap", registerBootstrapDetector],
    ["read-tracker", registerReadTracker],
    ["early-stop", registerEarlyStop],
    ["plan-anchor", registerPlanAnchor],
    ["error-diagnosis", registerErrorDiagnosis],
    ["trust-decay", registerTrustDecay],
    ["adaptive-temp", registerAdaptiveTemp],
    ["semantic-merge", registerSemanticMerge],
  ] as const;

  for (const [name, fn] of modules) {
    try {
      fn(pi, state);
      log.info(name, "Registered");
    } catch (err) {
      log.error(name, "Failed to register: %s", String(err));
      // Continue loading other modules — don't let one failure kill everything
    }
  }

  log.info("harness", "Loaded %d modules", modules.length);
}
