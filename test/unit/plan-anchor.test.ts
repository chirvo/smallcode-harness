/**
 * Unit tests: Plan Anchor
 */

import { test, expect } from "bun:test";
import { extractPlanSteps, buildDependencyBatches, formatPlanAnchor } from "../../src/plan-anchor.ts";

test("extractPlanSteps: parses numbered plan", () => {
  const text = `Here's my plan:
1. Read the auth module
2. Identify the JWT validation function
3. Add the refresh token handler
4. Update the route middleware
5. Run tests`;
  const steps = extractPlanSteps(text);
  expect(steps).not.toBeNull();
  expect(steps).toHaveLength(5);
  expect(steps![0]).toBe("Read the auth module");
  expect(steps![4]).toBe("Run tests");
});

test("extractPlanSteps: returns null for 1 or fewer steps", () => {
  expect(extractPlanSteps("1. Just one step")).toBeNull();
  expect(extractPlanSteps("No numbered list here")).toBeNull();
});

test("extractPlanSteps: ignores non-numbered text", () => {
  const text = "Let me think about this...\n1. First thing\nSome commentary\n2. Second thing";
  const steps = extractPlanSteps(text);
  expect(steps).not.toBeNull();
  expect(steps).toHaveLength(2);
});

test("buildDependencyBatches: independent steps = single batch", () => {
  const steps = [
    "Add error handling to utils.py",
    "Write tests for the new feature in test_main.py",
    "Update the README",
  ];
  const batches = buildDependencyBatches(steps);
  expect(batches).toHaveLength(1);
});

test("buildDependencyBatches: steps touching same file are dependent", () => {
  const steps = [
    "Add error handling to auth.py",
    "Write tests for auth.py",
    "Update README",
  ];
  const batches = buildDependencyBatches(steps);
  expect(batches.length).toBeGreaterThanOrEqual(2);
});

test("formatPlanAnchor: renders progress bar", () => {
  const result = formatPlanAnchor({
    steps: ["Read file", "Fix bug", "Run tests"],
    currentStep: 1,
    completed: [0],
  });
  expect(result).toContain("ACTIVE PLAN (step 2 of 3):");
  expect(result).toContain("✓ 1.");
  expect(result).toContain("→ 2.");
  expect(result).toContain("  3.");
});

test("formatPlanAnchor: all complete", () => {
  const result = formatPlanAnchor({
    steps: ["Step A", "Step B"],
    currentStep: 1,
    completed: [0, 1],
  });
  expect(result).toContain("✓ 1.");
  expect(result).toContain("✓ 2.");
});
