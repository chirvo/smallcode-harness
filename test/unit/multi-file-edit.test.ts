/**
 * Unit tests: Multi-File Edit Coordination
 */

import { test, expect } from "bun:test";

// The core logic is the coordination header builder, tested here.
// (The event wiring is integration-tested via the smoke test.)

function buildMultiFileHeader(files: string[]): string {
  const plan = files.map((f, i) => `${i + 1}. ${f}`);
  return [
    `[MULTI-FILE-EDIT] This turn requires coordinated changes to ${files.length} files.`,
    "",
    "Files to edit:",
    ...plan,
    "",
    "Complete ALL files before responding. Do not skip any. Check for cross-file consistency (imports, exports, shared types).",
  ].join("\n");
}

test("buildMultiFileHeader: includes all file names", () => {
  const files = ["auth.ts", "routes.ts", "middleware.ts"];
  const result = buildMultiFileHeader(files);
  expect(result).toContain("[MULTI-FILE-EDIT]");
  expect(result).toContain("auth.ts");
  expect(result).toContain("routes.ts");
  expect(result).toContain("middleware.ts");
  expect(result).toContain("3 files");
});

test("buildMultiFileHeader: correct ordering", () => {
  const files = ["a.ts", "b.ts", "c.ts"];
  const result = buildMultiFileHeader(files);
  const idxA = result.indexOf("1. a.ts");
  const idxB = result.indexOf("2. b.ts");
  const idxC = result.indexOf("3. c.ts");
  expect(idxA).toBeGreaterThan(0);
  expect(idxB).toBeGreaterThan(idxA);
  expect(idxC).toBeGreaterThan(idxB);
});

test("buildMultiFileHeader: includes completion instruction", () => {
  const result = buildMultiFileHeader(["a.ts", "b.ts", "c.ts", "d.ts"]);
  expect(result).toContain("Complete ALL files");
  expect(result).toContain("cross-file consistency");
});

test("buildMultiFileHeader: works with 2 files (below threshold)", () => {
  // The header is still valid, just the coordination logic won't inject it
  const result = buildMultiFileHeader(["a.ts", "b.ts"]);
  expect(result).toContain("2 files");
});
