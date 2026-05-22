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
