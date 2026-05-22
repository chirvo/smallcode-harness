/**
 * Unit tests: Early-Stop Detection
 */

import { test, expect } from "bun:test";
import { checkRepetition, checkGreeting } from "../../src/early-stop.ts";

test("checkRepetition: no repetition returns null", () => {
  expect(checkRepetition("The quick brown fox jumps over the lazy dog. This is a normal sentence.")).toBeNull();
});

test("checkRepetition: short buffer returns null", () => {
  expect(checkRepetition("short")).toBeNull();
});

test("checkRepetition: detects 3x repetition of 50-char pattern", () => {
  // The algorithm checks the TAIL (last 200 chars) for a repeating pattern.
  // The pattern is the last windowSize chars repeated 3+ times.
  const pattern = "Fix: import os. Add: sys.path. ";  // 28 chars
  const repeated = pattern.repeat(10);  // 280 chars — well over 200-char tail
  expect(checkRepetition(repeated)).not.toBeNull();
});

test("checkRepetition: 2x pattern is below threshold", () => {
  const repeated = "hello world hello world "; // only 2x
  expect(checkRepetition(repeated)).toBeNull();
});

test("checkGreeting: detects greeting mid-task", () => {
  const result = checkGreeting("how can i help you today?", true);
  expect(result).not.toBeNull();
  expect(result).toContain("greeting");
});

test("checkGreeting: no greeting when model has tool calls", () => {
  const result = checkGreeting("Here is the fix for the bug:", true);
  expect(result).toBeNull();
});

test("checkGreeting: no detection without tool calls", () => {
  const result = checkGreeting("how can i help you today?", false);
  expect(result).toBeNull();
});
