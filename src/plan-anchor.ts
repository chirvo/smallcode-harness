/**
 * Plan Anchor — Numbered Plan Extraction + Progress Bar
 *
 * For complex tasks, extracts a numbered plan from the LLM's first response,
 * then re-injects the current step on every subsequent turn. This prevents
 * small models from "forgetting" step 3 by the time they finish step 1.
 *
 * Also detects file-based dependencies between steps (two steps touching the
 * same file) using pure code — zero LLM calls for dependency analysis.
 *
 * Adapted from SmallCode's src/session/plan_tracker.js + dependency_graph.js
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { HarnessStateManager, PlanState } from "./state.ts";
import { log } from "./log.ts";

const ENV_KEY = "SMALLCODE_PLAN_ANCHOR";
const MAX_STEPS = 8;

// Regex-based plan extraction (falls back to null — user can also supply via prompt)
const PLAN_STEP_RE = /^\d+\.\s+(.+)$/gm;

export function extractPlanSteps(text: string): string[] | null {
  const steps: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = PLAN_STEP_RE.exec(text)) !== null) {
    const step = match[1].trim();
    if (step.length > 0) steps.push(step);
  }

  if (steps.length < 2) return null;
  return steps.slice(0, MAX_STEPS);
}

const FILE_PATH_RE = /["']?([a-zA-Z0-9_\-./]+\.(?:ts|js|tsx|jsx|py|rs|go|rb|java|kt|swift|c|cpp|h|hpp|css|scss|html|json|yaml|yml|toml|md))["']?/gi;

function extractFileReferences(text: string): string[] {
  const files: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = FILE_PATH_RE.exec(text)) !== null) {
    files.push(match[1]);
  }
  return [...new Set(files)];
}

/** Kahn's topological sort for dependency detection. */
export function buildDependencyBatches(steps: string[]): number[][] {
  const n = steps.length;
  const adj: number[][] = Array.from({ length: n }, () => []);
  const inDegree: number[] = new Array(n).fill(0);

  // Build dependency: step i depends on step j if same file mentioned
  const stepFiles = steps.map((s) => new Set(extractFileReferences(s)));

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < i; j++) {
      // Check if i's files overlap with j's files
      for (const f of stepFiles[i]) {
        if (stepFiles[j].has(f)) {
          // i depends on j
          adj[j].push(i);
          inDegree[i]++;
          break;
        }
      }
    }
  }

  // Kahn's algorithm
  const batches: number[][] = [];
  const queue: number[] = [];

  for (let i = 0; i < n; i++) {
    if (inDegree[i] === 0) queue.push(i);
  }

  while (queue.length > 0) {
    const batch: number[] = [];
    const batchSize = queue.length;
    for (let i = 0; i < batchSize; i++) {
      const node = queue.shift()!;
      batch.push(node);
      for (const neighbor of adj[node]) {
        inDegree[neighbor]--;
        if (inDegree[neighbor] === 0) queue.push(neighbor);
      }
    }
    batches.push(batch);
  }

  return batches;
}

export function formatPlanAnchor(plan: PlanState, batches?: number[][]): string {
  const { steps, currentStep, completed } = plan;
  const completedSet = new Set(completed);
  const lines: string[] = [`ACTIVE PLAN (step ${currentStep + 1} of ${steps.length}):`];

  for (let i = 0; i < steps.length; i++) {
    const prefix = completedSet.has(i) ? "✓" : i === currentStep ? "→" : " ";
    const style = completedSet.has(i) ? "(done)" : i === currentStep ? "(active)" : "";
    lines.push(`${prefix} ${i + 1}. ${steps[i]} ${style}`.trimEnd());
  }

  // Show batch groups if available
  if (batches && batches.length > 1) {
    const batchLines = batches.map(
      (batch, bi) => `  Batch ${bi + 1}: ${batch.map((si) => `${si + 1}. ${steps[si].slice(0, 40)}`).join(", ")}`,
    );
    lines.push(...batchLines);
  }

  return lines.join("\n");
}

/** Advance to next step after an edit/bash that relates to current step */
function advancePlan(state: PlanState): void {
  state.completed.push(state.currentStep);
  if (state.currentStep < state.steps.length - 1) {
    state.currentStep++;
  }
}

export function registerPlanAnchor(pi: ExtensionAPI, state: HarnessStateManager): void {
  const enabled = process.env[ENV_KEY] !== "false";
  if (!enabled) return;

  let stepAdvanceCooldown = 0;
  let turnsWithoutAdvancement = 0;
  const MAX_STALE_TURNS = 3;  // Clear plan if no advancement in 3 turns

  // Clear plan when a new user message doesn't reference the current plan
  pi.on("input", (event, _ctx: ExtensionContext) => {
    if (!state.state.plan || !state.state.planExtracted) return;
    if (event.source !== "interactive") return;

    const text = event.text.toLowerCase();
    const planSteps = state.state.plan.steps.join(" ").toLowerCase();

    // Check if the message references the plan at all
    const referencesPlan =
      text.includes("step") ||
      text.includes("plan") ||
      state.state.plan.steps.some((s) => {
        const keyWords = s.toLowerCase().split(/\s+/).filter((w) => w.length > 4);
        return keyWords.some((w) => text.includes(w));
      });

    if (!referencesPlan) {
      // New task that doesn't reference the plan — clear it
      clearPlan(state);
      log.debug("plan-anchor", "Cleared stale plan — new task detected");
    }
  });

  // Extract plan from first assistant message
  pi.on("message_end", (event, _ctx: ExtensionContext) => {
    if (state.state.planExtracted) return;
    if (event.message.role !== "assistant") return;

    const content = extractText(event.message);
    if (!content) return;

    const steps = extractPlanSteps(content);
    if (!steps) return;

    state.state.plan = {
      steps,
      currentStep: 0,
      completed: [],
    };
    state.state.planExtracted = true;
    turnsWithoutAdvancement = 0;
    log.info("plan-anchor", "Extracted plan: %d steps", steps.length);
    state.flush();
  });

  // Inject plan anchor into the system prompt before each LLM call
  pi.on("context", (event, _ctx: ExtensionContext) => {
    const plan = state.state.plan;
    if (!plan) return;

    const anchor = formatPlanAnchor(plan, undefined);
    // Prepend the plan anchor as context
    event.messages.push({
      role: "user" as const,
      content: [
        {
          type: "text" as const,
          text: anchor,
        },
      ],
      timestamp: Date.now(),
    });
  });

  // Detect step completion from tool results
  pi.on("tool_result", (event, _ctx: ExtensionContext) => {
    const plan = state.state.plan;
    if (!plan) return;

    // Cooldown: only advance once every few tool calls to prevent rapid cycling
    stepAdvanceCooldown++;
    if (stepAdvanceCooldown < 2) return;

    // Advance plan on successful edit or bash
    if (event.toolName === "edit" || event.toolName === "bash") {
      if (!event.isError) {
        advancePlan(plan);
        state.flush();
        stepAdvanceCooldown = 0;
      }
    }
  });

  // Reset cooldown on new turn + check for stale plan
  pi.on("turn_start", (_event, _ctx: ExtensionContext) => {
    stepAdvanceCooldown = 0;

    // Clear if no advancement in MAX_STALE_TURNS
    if (state.state.plan && state.state.planExtracted) {
      turnsWithoutAdvancement++;
      if (turnsWithoutAdvancement >= MAX_STALE_TURNS) {
        clearPlan(state);
        log.info("plan-anchor", "Cleared stale plan — %d turns without advancement", MAX_STALE_TURNS);
      }
    }
  });

  // Register /plan-clear command
  pi.registerCommand("plan-clear", {
    description: "Clear the active plan anchor",
    handler: async (_args, ctx) => {
      clearPlan(state);
      ctx.ui.notify("Plan anchor cleared", "info");
    },
  });
}

/**
 * Check if user input references the current plan.
 * Returns false if the message is about a different task — triggers plan clear.
 */
export function messageReferencesPlan(text: string, planSteps: string[]): boolean {
  const lower = text.toLowerCase();
  if (lower.includes("step") || lower.includes("plan")) return true;
  return planSteps.some((s) => {
    const keyWords = s.toLowerCase().split(/\s+/).filter((w) => w.length > 4);
    return keyWords.some((w) => lower.includes(w));
  });
}

/** Clear the active plan */
export function clearPlan(state: HarnessStateManager): void {
  state.state.plan = null;
  state.state.planExtracted = false;
  state.flush();
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
