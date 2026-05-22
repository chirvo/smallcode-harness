/**
 * SmallCode Harness — Pi Extension Entry Point
 *
 * Ports SmallCode's small-model compensatory patterns into pi's extension system.
 * Each module is independently toggleable via env vars and gracefully degrades.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { HarnessStateManager } from "./state.ts";
import { registerBootstrapDetector } from "./bootstrap-detector.ts";
import { registerReadTracker } from "./read-tracker.ts";
import { registerEarlyStop } from "./early-stop.ts";
import { registerPlanAnchor } from "./plan-anchor.ts";
import { registerErrorDiagnosis } from "./error-diagnosis.ts";
import { registerTrustDecay } from "./trust-decay.ts";
import { registerAdaptiveTemp } from "./adaptive-temp.ts";
import { registerSemanticMerge } from "./semantic-merge.ts";

export default function (pi: ExtensionAPI): void {
  // ── Shared state ──────────────────────────────────────────────────────────
  const state = new HarnessStateManager(pi);

  // ── Module registration (env-gated, all gracefully degrade) ───────────────
  registerBootstrapDetector(pi, state);
  registerReadTracker(pi, state);
  registerEarlyStop(pi, state);
  registerPlanAnchor(pi, state);
  registerErrorDiagnosis(pi, state);
  registerTrustDecay(pi, state);
  registerAdaptiveTemp(pi, state);
  registerSemanticMerge(pi, state);
}
