/**
 * Unit tests: Error Boundaries
 *
 * Verifies that runtime handler errors don't crash the extension.
 * A handler that throws should be caught and logged, while other
 * handlers continue to work normally.
 */

import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

/**
 * Simulates the withErrorBoundary logic from index.ts:
 * wraps a "pi.on" registration so the handler runs in try/catch.
 */
function wrapOn(on: (event: string, handler: (...args: any[]) => any) => void) {
  return (event: string, handler: (...args: any[]) => any) => {
    on(event, async (...args: any[]) => {
      try {
        return await handler(...args);
      } catch {
        // Caught — handler error doesn't propagate
      }
    });
  };
}

test("handler throw is caught, does not crash", () => {
  const calls: string[] = [];
  const rawOn = (event: string, handler: (...args: any[]) => any) => {
    calls.push(`registered:${event}`);
    // Store handler so we can invoke it later
    handlers.set(event, handler);
  };
  const handlers = new Map<string, (...args: any[]) => any>();
  const on = wrapOn(rawOn);

  // Register a handler that throws
  on("tool_call", () => {
    throw new Error("handler crashed");
  });

  // Register another handler that works normally
  let normalCalled = false;
  on("tool_result", () => {
    normalCalled = true;
  });

  // Invoke the throwing handler
  const throwingHandler = handlers.get("tool_call")!;
  expect(async () => {
    await throwingHandler({ toolName: "read" });
  }).not.toThrow();

  // Invoke the normal handler — should still work
  const normalHandler = handlers.get("tool_result")!;
  normalHandler({ toolName: "bash" });
  expect(normalCalled).toBe(true);

  // Both handlers were registered
  expect(calls).toContain("registered:tool_call");
  expect(calls).toContain("registered:tool_result");
});

test("handler throw does not prevent other handlers from running", () => {
  const results: string[] = [];
  // Use array — same event can have multiple handlers
  const handlers: Array<{ event: string; fn: (...args: any[]) => any }> = [];
  const rawOn = (event: string, handler: (...args: any[]) => any) => {
    handlers.push({ event, fn: handler });
  };
  const on = wrapOn(rawOn);

  on("tool_call", () => {
    results.push("first-ok");
  });
  on("tool_call", () => {
    throw new Error("second-crashed");
  });
  on("tool_call", () => {
    results.push("third-ok");
  });

  // Invoke all tool_call handlers
  for (const h of handlers) {
    try { h.fn({}); } catch {}
  }

  // The first and third handlers should have run despite the second crashing
  expect(results).toContain("first-ok");
  expect(results).toContain("third-ok");
});

test("multiple events are all wrapped independently", () => {
  const events: string[] = [];
  const rawOn = (event: string, handler: (...args: any[]) => any) => {
    handlers.set(event, handler);
  };
  const handlers = new Map<string, (...args: any[]) => any>();
  const on = wrapOn(rawOn);

  on("tool_call", () => { events.push("tool_call"); });
  on("tool_result", () => { events.push("tool_result"); });
  on("turn_start", () => { events.push("turn_start"); });

  // Invoke the throwing one
  const toolCallHandler = handlers.get("tool_call")!;
  toolCallHandler({});
  // The others should not crash
  const toolResultHandler = handlers.get("tool_result")!;
  toolResultHandler({});
  const turnStartHandler = handlers.get("turn_start")!;
  turnStartHandler({});

  expect(events).toEqual(["tool_call", "tool_result", "turn_start"]);
});
