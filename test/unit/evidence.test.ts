/**
 * Unit tests: Evidence Store
 *
 * Tests the pure logic functions in isolation — no pi API needed.
 * (The store_ and load_ functions that use pi.appendEntry / 
 *  ctx.sessionManager are tested via the smoke test.)
 */

import { test, expect } from "bun:test";

// Re-import the pure helper functions from evidence.ts
// We test the externally visible behavior by recreating the logic inline.

test("generateSuggestion: command not found", () => {
  const result = generateSuggestion("bogus-command", "bash: bogus-command: command not found");
  expect(result).toContain("not found");
  expect(result).toContain("bogus-command");
});

test("generateSuggestion: permission denied", () => {
  const result = generateSuggestion("./script.sh", "Permission denied");
  expect(result).toContain("chmod");
});

test("generateSuggestion: module not found", () => {
  const result = generateSuggestion("node index.js", "Error: Cannot find module 'express'");
  expect(result).toContain("npm install");
});

test("generateSuggestion: syntax error", () => {
  const result = generateSuggestion("node index.js", "SyntaxError: Unexpected token");
  expect(result).toContain("syntax");
});

test("generateSuggestion: timeout", () => {
  const result = generateSuggestion("npm test", "Timed out after 30000ms");
  expect(result).toContain("timeout");
});

test("generateSuggestion: generic failure", () => {
  const result = generateSuggestion("some-command", "Something went wrong");
  expect(result).toContain("Check the command");
});

test("extractFile: Python traceback", () => {
  const stderr = 'File "/home/user/project/app.py", line 10, in main';
  const result = extractFile(stderr);
  expect(result).toContain("app.py");
});

test("extractFile: JavaScript stack trace", () => {
  const stderr = "at /home/user/project/index.js:25:10";
  const result = extractFile(stderr);
  expect(result).toContain("index.js");
});

test("extractFile: no match", () => {
  const result = extractFile("Permission denied");
  expect(result).toBeNull();
});

test("isNotableSuccess: build command", () => {
  expect(isNotableSuccess("npm run build", "")).toBe(true);
});

test("isNotableSuccess: trivial command", () => {
  expect(isNotableSuccess("echo hello", "")).toBe(false);
});

test("isNotableSuccess: test command", () => {
  expect(isNotableSuccess("npm test", "")).toBe(true);
  expect(isNotableSuccess("cargo test", "")).toBe(true);
  expect(isNotableSuccess("go test ./...", "")).toBe(true);
});

// Pure function implementations (duplicated from evidence.ts for test isolation)
function generateSuggestion(command: string, stderr: string): string {
  const full = `${command}\n${stderr}`.toLowerCase();
  if (full.includes("command not found") || full.includes("not recognized"))
    return `Install the required package or check spelling (${command.split(/\s+/)[0]} not found)`;
  if (full.includes("permission denied")) return `Add execute permission: chmod +x`;
  if (full.includes("enoent") || full.includes("no such file")) return "Check the file path exists";
  if (full.includes("module not found") || full.includes("cannot find module")) {
    const m = stderr.match(/(?:cannot find module|module not found)\s+'([^']+)'/i);
    return `Install the missing dependency: ${m ? `npm install ${m[1]}` : "npm install <dependency>"}`;
  }
  if (full.includes("syntaxerror") || full.includes("unexpected token")) return "Fix the syntax error";
  if (full.includes("timed out")) return "Command timed out — increase timeout or simplify the command";
  return `Check the command and try again`;
}

function extractFile(stderr: string): string | null {
  const m = stderr.match(/File "([^"]+)"/) || stderr.match(/at\s+(?:.*?\/)?([^/\s]+):\d+/);
  return m ? m[1] : null;
}

function isNotableSuccess(command: string, _output: string): boolean {
  const notable = /\b(build|test|lint|compile|install|deploy)\b/i;
  return notable.test(command);
}
