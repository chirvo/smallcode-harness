/**
 * Unit tests: Semantic Merge
 */

import { test, expect } from "bun:test";
import { trySimpleMerge } from "../../src/semantic-merge.ts";

test("trySimpleMerge: replaces matching first line", () => {
  const current = `def old_function():
    pass

def another():
    pass
`;
  const newStr = `def new_function():
    return 42
`;
  const oldStr = `def old_function():
    pass`;

  const result = trySimpleMerge(current, newStr, oldStr);
  expect(result).not.toBeNull();
  expect(result).toContain("def new_function():");
  expect(result).toContain("return 42");
  expect(result).toContain("def another():");
});

test("trySimpleMerge: no match returns null", () => {
  const current = "line one\nline two";
  const result = trySimpleMerge(current, "new content", "nonexistent line");
  expect(result).toBeNull();
});

test("trySimpleMerge: exact match works", () => {
  const current = "keep this\nREPLACE ME\nalso keep this";
  const result = trySimpleMerge(current, "REPLACED", "REPLACE ME");
  expect(result).toBe("keep this\nREPLACED\nalso keep this");
});
