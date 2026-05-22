/**
 * Unit tests: Error Diagnosis
 */

import { test, expect } from "bun:test";
import { classifyError } from "../../src/error-diagnosis.ts";

test("classifyError: Python SyntaxError", () => {
  const d = classifyError("python script.py", 'File "script.py", line 5\nSyntaxError: invalid syntax', 1);
  expect(d.type).toBe("syntax");
  expect(d.file).toBe("script.py");
  expect(d.line).toBe(5);
  expect(d.suggestion).toContain("Fix the");
});

test("classifyError: module not found", () => {
  const d = classifyError("node index.js", "Error: Cannot find module 'express'", 1);
  expect(d.type).toBe("syntax");
  expect(d.suggestion).toBeDefined();
});

test("classifyError: command not found", () => {
  const d = classifyError("bogus-command", "bash: bogus-command: command not found", 127);
  expect(d.type).toBe("notfound");
  expect(d.suggestion).toContain("Install");
});

test("classifyError: permission denied", () => {
  const d = classifyError("./script.sh", "bash: ./script.sh: Permission denied", 126);
  expect(d.type).toBe("permission");
  expect(d.suggestion).toContain("permission");
});

test("classifyError: timeout", () => {
  const d = classifyError("npm test", "Timed out after 30000ms", 124);
  expect(d.type).toBe("timeout");
  expect(d.suggestion).toContain("shorter timeout");
});

test("classifyError: TypeScript error extracts file:line", () => {
  const d = classifyError("npx tsc", "src/index.ts:5:3 - error TS2322: Type 'string' is not assignable to type 'number'", 2);
  expect(d.file).toBe("src/index.ts");
  expect(d.line).toBe(5);
});

test("classifyError: unknown exit code with no stderr", () => {
  const d = classifyError("some-command", "", 1);
  expect(d.type).toBe("unknown");
  expect(d.suggestion).toContain("Exit code 1");
});
