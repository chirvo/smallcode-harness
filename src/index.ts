/**
 * SmallCode Harness — Pi Extension Entry Point
 *
 * Ports SmallCode's small-model compensatory patterns into pi's extension system.
 * Each module is independently toggleable via env vars and gracefully degrades.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { HarnessStateManager } from "./state.ts";
import { setLogDir, log } from "./log.ts";
import { loadConfig } from "./config.ts";
import { restoreEvidence } from "./evidence.ts";

// Original 8 modules
import { registerBootstrapDetector } from "./bootstrap-detector.ts";
import { registerReadTracker } from "./read-tracker.ts";
import { registerEarlyStop } from "./early-stop.ts";
import { registerPlanAnchor } from "./plan-anchor.ts";
import { registerErrorDiagnosis } from "./error-diagnosis.ts";
import { registerTrustDecay } from "./trust-decay.ts";
import { registerAdaptiveTemp } from "./adaptive-temp.ts";
import { registerSemanticMerge } from "./semantic-merge.ts";

// New 5 modules — LLM-assisted DX improvements
import { registerAutoValidate } from "./auto-validate.ts";
import { registerEvidenceStore } from "./evidence.ts";
import { registerMultiFileEdit } from "./multi-file-edit.ts";
import { registerSnapshot } from "./snapshot.ts";
import { registerTaskDecomposition } from "./task-decomposition.ts";

/**
 * Wrap pi.on() so that if any handler throws, the error is caught and logged
 * instead of crashing the extension. Each handler runs independently — one
 * broken handler doesn't affect other handlers or modules.
 */
function withErrorBoundary(pi: ExtensionAPI): ExtensionAPI {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const api = pi as any;
  const originalOn = api.on.bind(api);
  api.on = (event: string, handler: (...args: any[]) => any) => {
    originalOn(event, async (eventData: unknown, ctx: unknown) => {
      try {
        return await handler(eventData, ctx);
      } catch (err) {
        log.error("runtime", "Handler for '%s' threw: %s", event, String(err));
      }
    });
  };
  return pi;
}

export default function (pi: ExtensionAPI): void {
  const safePi = withErrorBoundary(pi);
  const state = new HarnessStateManager(safePi);

  // Init logging + restore evidence from session
  safePi.on("session_start", (_event, ctx: ExtensionContext) => {
    setLogDir(ctx.cwd + "/.smallcode");
    restoreEvidence(ctx);
  });

  const cfg = loadConfig();

  interface ModuleRegistration {
    name: string;
    fn: (pi: ExtensionAPI, state: HarnessStateManager) => void;
    env?: boolean;
  }

  const modules: ModuleRegistration[] = [
    // Original 8
    { name: "bootstrap", fn: registerBootstrapDetector },
    { name: "read-tracker", fn: registerReadTracker },
    { name: "early-stop", fn: registerEarlyStop },
    { name: "plan-anchor", fn: registerPlanAnchor },
    { name: "error-diagnosis", fn: registerErrorDiagnosis },
    { name: "trust-decay", fn: registerTrustDecay },
    { name: "adaptive-temp", fn: registerAdaptiveTemp },
    { name: "semantic-merge", fn: registerSemanticMerge },

    // New 5 — LLM-assisted DX
    { name: "auto-validate", fn: registerAutoValidate, env: cfg.autoValidate },
    { name: "evidence", fn: registerEvidenceStore, env: cfg.evidence },
    { name: "multi-file-edit", fn: registerMultiFileEdit, env: cfg.multiFileEdit },
    { name: "snapshot", fn: registerSnapshot, env: cfg.snapshot },
    { name: "task-decomposition", fn: registerTaskDecomposition, env: cfg.taskDecomposition },
  ];

  for (const mod of modules) {
    if (mod.env === false) {
      log.debug(mod.name, "Disabled by config");
      continue;
    }
    try {
      mod.fn(safePi, state);
      log.info(mod.name, "Registered");
    } catch (err) {
      log.error(mod.name, "Failed to register: %s", String(err));
    }
  }

  log.info("harness", "Loaded %d modules", modules.length);
}
