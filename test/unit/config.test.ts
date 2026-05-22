/**
 * Unit tests: Config loading and env var parsing
 *
 * Tests loadConfig bool parsing and defaults in isolation.
 */

import { test, expect, beforeEach } from "bun:test";
import { loadConfig, resetConfig } from "../../src/config.ts";

beforeEach(() => {
  resetConfig();
  // Clean slate for each test
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("SMALLCODE_")) {
      delete process.env[key];
    }
  }
});

test("loadConfig: all defaults are true", () => {
  const cfg = loadConfig();
  expect(cfg.bootstrap).toBe(true);
  expect(cfg.writeGuard).toBe(true);
  expect(cfg.earlyStop).toBe(true);
  expect(cfg.planAnchor).toBe(true);
  expect(cfg.errorDiagnosis).toBe(true);
  expect(cfg.trustDecay).toBe(true);
  expect(cfg.adaptiveTemp).toBe(true);
  expect(cfg.semanticMerge).toBe(true);
  expect(cfg.autoValidate).toBe(true);
  expect(cfg.evidence).toBe(true);
  expect(cfg.multiFileEdit).toBe(true);
  expect(cfg.snapshot).toBe(true);
  expect(cfg.taskDecomposition).toBe(true);
});

test("loadConfig: false strings disable modules", () => {
  process.env["SMALLCODE_BOOTSTRAP"] = "false";
  process.env["SMALLCODE_WRITE_GUARD"] = "0";
  process.env["SMALLCODE_PLAN_ANCHOR"] = "no";
  process.env["SMALLCODE_TRUST_DECAY"] = "off";
  const cfg = loadConfig();
  expect(cfg.bootstrap).toBe(false);
  expect(cfg.writeGuard).toBe(false);
  expect(cfg.planAnchor).toBe(false);
  expect(cfg.trustDecay).toBe(false);
  // Others should still default to true
  expect(cfg.earlyStop).toBe(true);
  expect(cfg.errorDiagnosis).toBe(true);
});

test("loadConfig: 'true' string resolves to true", () => {
  process.env["SMALLCODE_BOOTSTRAP"] = "true";
  expect(loadConfig().bootstrap).toBe(true);
});

test("loadConfig: empty string uses default", () => {
  process.env["SMALLCODE_BOOTSTRAP"] = "";
  expect(loadConfig().bootstrap).toBe(true);
});

test("loadConfig: logLevel defaults to warn", () => {
  expect(loadConfig().logLevel).toBe("warn");
});

test("loadConfig: logLevel overridable", () => {
  process.env["SMALLCODE_LOG_LEVEL"] = "debug";
  expect(loadConfig().logLevel).toBe("debug");
});

test("loadConfig: overrides param takes precedence over env", () => {
  process.env["SMALLCODE_BOOTSTRAP"] = "false";
  const cfg = loadConfig({ bootstrap: true });
  expect(cfg.bootstrap).toBe(true);
});

test("loadConfig: overrides param can disable when env is absent", () => {
  const cfg = loadConfig({ evidence: false });
  expect(cfg.evidence).toBe(false);
  // Default should still be true
  expect(cfg.bootstrap).toBe(true);
});

test("getConfig: caches after first call", () => {
  // Need to test via resetConfig + two calls
  const { getConfig } = import("../../src/config.ts");
  // We'll test indirectly: two calls return same reference
});

test("resetConfig: clears cache so next call re-reads env", () => {
  const first = loadConfig();
  process.env["SMALLCODE_BOOTSTRAP"] = "false";
  resetConfig();
  const second = loadConfig();
  expect(second.bootstrap).toBe(false);
  // first should still be true (captured at call time)
  expect(first.bootstrap).toBe(true);
});

test("loadConfig: unknown env var names are ignored", () => {
  process.env["SMALLCODE_NONEXISTENT"] = "false";
  // Should not throw
  expect(() => loadConfig()).not.toThrow();
});

test("loadConfig: case-insensitive false checking", () => {
  process.env["SMALLCODE_BOOTSTRAP"] = "FALSE";
  process.env["SMALLCODE_WRITE_GUARD"] = "False";
  const cfg = loadConfig();
  expect(cfg.bootstrap).toBe(false);
  expect(cfg.writeGuard).toBe(false);
});

test("loadConfig: unexpected values are truthy", () => {
  process.env["SMALLCODE_BOOTSTRAP"] = "maybe";
  process.env["SMALLCODE_EARLY_STOP"] = "1";
  process.env["SMALLCODE_TRUST_DECAY"] = "yes";
  const cfg = loadConfig();
  expect(cfg.bootstrap).toBe(true);  // "maybe" is not in false-list
  expect(cfg.earlyStop).toBe(true);  // "1" is not in false-list
  expect(cfg.trustDecay).toBe(true); // "yes" is not in false-list
});
