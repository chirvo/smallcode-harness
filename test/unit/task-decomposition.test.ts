/**
 * Unit tests: Task Decomposition
 */

import { test, expect } from "bun:test";

// Pure functions tested inline (same logic as the module)

const VALID_STRATEGIES = ["split_file", "one_error_at_a_time", "rewrite_section", "extract_function"] as const;

interface DecomposeResult {
  strategy: string;
  instruction: string;
}

function pickDecomposeStrategy(content: string, errors: string, filePath: string): DecomposeResult {
  const lines = content.split("\n").length;
  const errorCount = errors.split("error").length - 1;

  if (lines > 80) {
    return {
      strategy: "split_file",
      instruction: `The file ${filePath} is too complex to fix in one go (${lines} lines, ${errorCount} errors). Split it.`,
    };
  }

  if (errorCount > 1) {
    const firstError = errors.split("\n").find((l) => l.includes("error")) || errors.slice(0, 100);
    return {
      strategy: "one_error_at_a_time",
      instruction: `Found ${errorCount} errors. Fix ONE error only:\n\n${firstError}`,
    };
  }

  return {
    strategy: "rewrite_section",
    instruction: `The fix attempts aren't working. Rewrite the section from scratch.\n\nError: ${errors.slice(0, 150)}`,
  };
}

test("pickDecomposeStrategy: large file → split_file", () => {
  const content = Array.from({ length: 100 }, (_, i) => `line ${i}`).join("\n");
  const result = pickDecomposeStrategy(content, "error TS2321: type mismatch", "big.ts");
  expect(result.strategy).toBe("split_file");
  expect(result.instruction).toContain("big.ts");
  expect(result.instruction).toContain("100 lines");
});

test("pickDecomposeStrategy: multiple errors → one_error_at_a_time", () => {
  const content = "function foo() { return 1; }";
  const errors = "line 5: error TS2321: type mismatch\nline 10: error TS2554: wrong args";
  const result = pickDecomposeStrategy(content, errors, "app.ts");
  expect(result.strategy).toBe("one_error_at_a_time");
  expect(result.instruction).toContain("2 errors");
  expect(result.instruction).toContain("Fix ONE error");
});

test("pickDecomposeStrategy: single persistent error → rewrite_section", () => {
  const content = "function foo() { return 1; }";
  const errors = "error TS2321: type mismatch";
  const result = pickDecomposeStrategy(content, errors, "app.ts");
  expect(result.strategy).toBe("rewrite_section");
  expect(result.instruction).toContain("Rewrite");
});

test("pickDecomposeStrategy: exactly 80 lines → not split_file", () => {
  const content = Array.from({ length: 80 }, (_, i) => `line ${i}`).join("\n");
  const result = pickDecomposeStrategy(content, "error TS2321", "app.ts");
  // 80 is not > 80, so it won't be split_file
  expect(result.strategy).not.toBe("split_file");
});

test("pickDecomposeStrategy: strategy is always one of valid values", () => {
  const cases: Array<{ content: string; errors: string }> = [
    { content: "a\n".repeat(90), errors: "error E1" },
    { content: "short", errors: "error E1\nerror E2" },
    { content: "short", errors: "error E1" },
  ];
  for (const c of cases) {
    const result = pickDecomposeStrategy(c.content, c.errors, "f.ts");
    expect(VALID_STRATEGIES).toContain(result.strategy);
  }
});
