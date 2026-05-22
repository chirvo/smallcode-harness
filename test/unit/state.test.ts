/**
 * Unit tests: HarnessStateManager (without pi API)
 *
 * Tests the state management logic in isolation using a minimal mock pi.
 */

import { test, expect } from "bun:test";
import { HarnessStateManager } from "../../src/state.ts";

function mockPi(): any {
  const entries: any[] = [];
  return {
    on() {},
    appendEntry(type: string, data: any) {
      entries.push({ type, data });
    },
    _entries: entries,
  };
}

test("HarnessStateManager: tracks reads", () => {
  const pi = mockPi();
  const state = new HarnessStateManager(pi as any);

  expect(state.hasRead("foo.ts")).toBe(false);
  state.recordRead("foo.ts");
  expect(state.hasRead("foo.ts")).toBe(true);
});

test("HarnessStateManager: tracks writes", () => {
  const pi = mockPi();
  const state = new HarnessStateManager(pi as any);

  expect(state.hasWritten("bar.ts")).toBe(false);
  state.recordWrite("bar.ts");
  expect(state.hasWritten("bar.ts")).toBe(true);
});

test("HarnessStateManager: duplicate read is idempotent", () => {
  const pi = mockPi();
  const state = new HarnessStateManager(pi as any);

  state.recordRead("x.ts");
  state.recordRead("x.ts"); // duplicate
  expect(state.state.readFiles).toHaveLength(1);
});

test("HarnessStateManager: patch failure tracking", () => {
  const pi = mockPi();
  const state = new HarnessStateManager(pi as any);

  expect(state.recordPatchFailure("app.ts")).toBe(1);
  expect(state.recordPatchFailure("app.ts")).toBe(2);
  expect(state.getPatchFailures("app.ts")).toBe(2);
});

test("HarnessStateManager: patch success reduces counter", () => {
  const pi = mockPi();
  const state = new HarnessStateManager(pi as any);

  state.recordPatchFailure("app.ts");
  state.recordPatchFailure("app.ts");
  state.recordPatchSuccess("app.ts");
  expect(state.getPatchFailures("app.ts")).toBe(1);
});

test("HarnessStateManager: read streak tracking", () => {
  const pi = mockPi();
  const state = new HarnessStateManager(pi as any);

  expect(state.incrementReadStreak()).toBe(1);
  expect(state.incrementReadStreak()).toBe(2);
  expect(state.getReadStreak()).toBe(2);

  state.resetReadStreak();
  expect(state.getReadStreak()).toBe(0);
});

test("HarnessStateManager: tool trust tracking", () => {
  const pi = mockPi();
  const state = new HarnessStateManager(pi as any);

  state.recordToolSuccess("read");
  expect(state.getTrust("read").totalCalls).toBe(1);
  expect(state.getTrust("read").consecutiveFailures).toBe(0);

  state.recordToolFailure("read");
  expect(state.getTrust("read").consecutiveFailures).toBe(1);

  state.recordToolSuccess("read"); // resets to 0
  expect(state.getTrust("read").consecutiveFailures).toBe(0);
});

test("HarnessStateManager: newTurn resets per-turn counters", () => {
  const pi = mockPi();
  const state = new HarnessStateManager(pi as any);

  state.recordPatchFailure("x.ts");
  state.incrementReadStreak();
  state.newTurn();

  expect(state.getPatchFailures("x.ts")).toBe(0);
  expect(state.getReadStreak()).toBe(0);
  expect(state.state.currentTurn).toBe(1);
});

test("HarnessStateManager: isReadTool / isWriteTool classification", () => {
  const pi = mockPi();
  const state = new HarnessStateManager(pi as any);

  expect(state.isReadTool("read")).toBe(true);
  expect(state.isReadTool("grep")).toBe(true);
  expect(state.isReadTool("bash")).toBe(false);

  expect(state.isWriteTool("write")).toBe(true);
  expect(state.isWriteTool("edit")).toBe(true);
  expect(state.isWriteTool("read")).toBe(false);
});

test("HarnessStateManager: full read tool classification set", () => {
  const pi = mockPi();
  const state = new HarnessStateManager(pi as any);

  // All expected read tools
  for (const tool of ["read", "grep", "find", "ls", "search"]) {
    expect(state.isReadTool(tool)).toBe(true);
  }

  // Write and execution tools are NOT read tools
  expect(state.isReadTool("write")).toBe(false);
  expect(state.isReadTool("edit")).toBe(false);
  expect(state.isReadTool("bash")).toBe(false);
});

test("HarnessStateManager: full write tool classification set", () => {
  const pi = mockPi();
  const state = new HarnessStateManager(pi as any);

  for (const tool of ["write", "edit"]) {
    expect(state.isWriteTool(tool)).toBe(true);
  }

  expect(state.isWriteTool("read")).toBe(false);
  expect(state.isWriteTool("bash")).toBe(false);
  expect(state.isWriteTool("grep")).toBe(false);
});

test("HarnessStateManager: flush writes to pi.appendEntry when dirty", () => {
  const pi = mockPi();
  const state = new HarnessStateManager(pi as any);

  state.recordRead("x.ts");
  state.flush();

  expect(pi._entries).toHaveLength(1);
  expect(pi._entries[0].type).toBe("sc-harness-state");
  expect(pi._entries[0].data.readFiles).toContain("x.ts");
});

test("HarnessStateManager: flush skips write when not dirty", () => {
  const pi = mockPi();
  const state = new HarnessStateManager(pi as any);

  // No mutations made
  state.flush();
  expect(pi._entries).toHaveLength(0);
});

test("HarnessStateManager: flush after multiple mutations writes full state", () => {
  const pi = mockPi();
  const state = new HarnessStateManager(pi as any);

  state.recordRead("a.ts");
  state.recordWrite("b.ts");
  state.recordToolFailure("bash");
  state.flush();

  const data = pi._entries[0].data;
  expect(data.readFiles).toContain("a.ts");
  expect(data.writtenFiles).toContain("b.ts");
  expect(data.toolTrust.bash.consecutiveFailures).toBe(1);
});

test("HarnessStateManager: improvementAttempts tracking", () => {
  const pi = mockPi();
  const state = new HarnessStateManager(pi as any);

  expect(state.getImprovementAttempts("app.ts")).toBe(0);

  expect(state.incrementImprovementAttempts("app.ts")).toBe(1);
  expect(state.incrementImprovementAttempts("app.ts")).toBe(2);
  expect(state.getImprovementAttempts("app.ts")).toBe(2);

  // Different file is independent
  expect(state.getImprovementAttempts("other.ts")).toBe(0);
});

test("HarnessStateManager: bootstrap state management", () => {
  const pi = mockPi();
  const state = new HarnessStateManager(pi as any);

  expect(state.state.bootstrap).toBeNull();
  expect(state.state.bootstrapDone).toBe(false);

  state.state.bootstrap = { runtime: "node", version: null, packageManager: null, framework: null, entryPoint: null, testCommand: null, buildCommand: null, runCommand: null };
  state.state.bootstrapDone = true;

  expect(state.state.bootstrap?.runtime).toBe("node");
  expect(state.state.bootstrapDone).toBe(true);
});

test("HarnessStateManager: plan state management", () => {
  const pi = mockPi();
  const state = new HarnessStateManager(pi as any);

  expect(state.state.plan).toBeNull();
  expect(state.state.planExtracted).toBe(false);

  state.state.plan = { steps: ["do A", "do B"], currentStep: 0, completed: [] };
  state.state.planExtracted = true;

  expect(state.state.plan?.steps).toHaveLength(2);
  expect(state.state.plan?.currentStep).toBe(0);
});

test("HarnessStateManager: tool trust created lazily on getTrust", () => {
  const pi = mockPi();
  const state = new HarnessStateManager(pi as any);

  const trust = state.getTrust("never-seen-before");
  expect(trust.consecutiveFailures).toBe(0);
  expect(trust.totalCalls).toBe(0);
});

test("HarnessStateManager: getPatchAttempts returns 0 for unknown file", () => {
  const pi = mockPi();
  const state = new HarnessStateManager(pi as any);

  expect(state.getPatchAttempts("nonexistent.ts")).toBe(0);
});

test("HarnessStateManager: newTurn increments turn count", () => {
  const pi = mockPi();
  const state = new HarnessStateManager(pi as any);

  expect(state.state.currentTurn).toBe(0);
  state.newTurn();
  expect(state.state.currentTurn).toBe(1);
  state.newTurn();
  expect(state.state.currentTurn).toBe(2);
});

test("HarnessStateManager: hasWritten returns false for unwritten files", () => {
  const pi = mockPi();
  const state = new HarnessStateManager(pi as any);

  expect(state.hasWritten("unknown.ts")).toBe(false);
});

test("HarnessStateManager: hasRead returns false for unread files", () => {
  const pi = mockPi();
  const state = new HarnessStateManager(pi as any);

  expect(state.hasRead("unknown.ts")).toBe(false);
});
