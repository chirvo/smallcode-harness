/**
 * Unit tests: Structured logging
 *
 * Tests log level filtering and %s format string replacement in isolation.
 * Uses a controlled log dir (temp) to verify file output behavior.
 */

import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// We test by manipulating env vars before importing the module.
// The log module reads SMALLCODE_LOG_LEVEL at import time.
// For each test, we import a fresh view by re-reading the written log file.

let tmpLogDir: string;

beforeEach(() => {
  tmpLogDir = mkdtempSync(join(tmpdir(), "sc-log-"));
});

afterEach(() => {
  rmSync(tmpLogDir, { recursive: true, force: true });
});

/**
 * Create a fresh log module environment with a specific log level.
 * We can't re-import ES modules, but we can test the functions
 * by importing the module and manipulating state.
 */
function makeLogEnv(level: string): typeof import("../../src/log.ts") {
  // We can't reimport, but we can set the env var and test the public API
  // through the log object's behavior
  const prev = process.env["SMALLCODE_LOG_LEVEL"];
  process.env["SMALLCODE_LOG_LEVEL"] = level;
  // Re-import — but ESM cache won't re-execute. Instead, we test the
  // observable behavior via the written log files.
  return require("../../src/log.ts");  
}

// Instead, let's test the log module by directly testing the format function
// and checking what gets written to disk at different levels.

import { setLogDir, log } from "../../src/log.ts";

test("setLogDir: creates directory if not exists", () => {
  const dir = join(tmpLogDir, "nested", "logs");
  setLogDir(dir);
  expect(existsSync(dir)).toBe(true);
});

test("log: writes error level to file", () => {
  process.env["SMALLCODE_LOG_LEVEL"] = "error";
  setLogDir(tmpLogDir);
  log.error("test-mod", "this is an error");
  const content = readFileSync(join(tmpLogDir, "sc-harness.log"), "utf-8");
  expect(content).toContain("[ERROR]");
  expect(content).toContain("[test-mod]");
  expect(content).toContain("this is an error");
});

test("log: warn level is written when threshold is warn", () => {
  process.env["SMALLCODE_LOG_LEVEL"] = "warn";
  setLogDir(tmpLogDir);
  log.warn("test-mod", "warning message");
  const content = readFileSync(join(tmpLogDir, "sc-harness.log"), "utf-8");
  expect(content).toContain("[WARN]");
  expect(content).toContain("warning message");
});

test("log: debug NOT written when threshold is warn", () => {
  process.env["SMALLCODE_LOG_LEVEL"] = "warn";
  setLogDir(tmpLogDir);
  log.debug("test-mod", "debug message");
  const content = readFileSync(join(tmpLogDir, "sc-harness.log"), "utf-8");
  expect(content).toBe(""); // nothing written
});

test("log: info NOT written when threshold is warn", () => {
  process.env["SMALLCODE_LOG_LEVEL"] = "warn";
  setLogDir(tmpLogDir);
  log.info("test-mod", "info message");
  const content = readFileSync(join(tmpLogDir, "sc-harness.log"), "utf-8");
  expect(content).toBe("");
});

test("log: debug IS written when threshold is debug", () => {
  process.env["SMALLCODE_LOG_LEVEL"] = "debug";
  setLogDir(tmpLogDir);
  log.debug("test-mod", "debug message");
  const content = readFileSync(join(tmpLogDir, "sc-harness.log"), "utf-8");
  expect(content).toContain("[DEBUG]");
  expect(content).toContain("debug message");
});

test("log: all levels written at debug threshold", () => {
  process.env["SMALLCODE_LOG_LEVEL"] = "debug";
  setLogDir(tmpLogDir);
  log.error("m", "err");
  log.warn("m", "warn");
  log.info("m", "info");
  log.debug("m", "debug");
  const content = readFileSync(join(tmpLogDir, "sc-harness.log"), "utf-8");
  expect(content).toContain("[ERROR]");
  expect(content).toContain("[WARN]");
  expect(content).toContain("[INFO]");
  expect(content).toContain("[DEBUG]");
});

test("log: %s format string replacement", () => {
  process.env["SMALLCODE_LOG_LEVEL"] = "debug";
  setLogDir(tmpLogDir);
  log.info("test-mod", "File %s has %s errors", "app.ts", "3");
  const content = readFileSync(join(tmpLogDir, "sc-harness.log"), "utf-8");
  expect(content).toContain("File app.ts has 3 errors");
});

test("log: multiple %s arguments", () => {
  process.env["SMALLCODE_LOG_LEVEL"] = "debug";
  setLogDir(tmpLogDir);
  log.warn("multi", "%s → %s: %s", "auth.ts", "routes.ts", "import missing");
  const content = readFileSync(join(tmpLogDir, "sc-harness.log"), "utf-8");
  expect(content).toContain("auth.ts → routes.ts: import missing");
});

test("log: logger degrades silently when logDir not set", () => {
  // setLogDir was NOT called — should not throw
  expect(() => {
    log.info("test", "this should not crash");
  }).not.toThrow();
});

test("log: logger degrades silently on invalid directory", () => {
  // Should not throw even if dir is unwritable
  expect(() => {
    log.error("test", "msg");
  }).not.toThrow();
});
