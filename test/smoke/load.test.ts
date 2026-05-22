/**
 * Smoke Test — Verifies the extension loads without errors in pi.
 *
 * Uses bun to import the extension module directly and verify the
 * default export is a function that registers event handlers.
 */

import { test, expect } from "bun:test";

// Load the extension module
const ext = await import("../../src/index.ts");

test("extension exports a default function", () => {
  expect(typeof ext.default).toBe("function");
});

test("extension registers hooks when invoked", () => {
  const events: string[] = [];
  const pi = {
    on(event: string) {
      events.push(event);
    },
    on: (event: string, _handler: Function) => {
      events.push(event);
    },
    appendEntry: () => {},
    setActiveTools: () => {},
    getActiveTools: () => ["read", "bash", "write", "edit", "grep", "find", "ls", "search"],
    sendMessage: () => {},
    getAllTools: () => [],
  };

  ext.default(pi as any);

  // Should have registered for these events
  expect(events).toContain("session_start");
  expect(events).toContain("before_agent_start");
  expect(events).toContain("tool_call");
  expect(events).toContain("tool_result");
  expect(events).toContain("message_end");
  expect(events).toContain("turn_start");
  expect(events).toContain("turn_end");
  expect(events).toContain("context");
  expect(events).toContain("before_provider_request");
});
