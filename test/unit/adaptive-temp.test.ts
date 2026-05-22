/**
 * Unit tests: Adaptive Temperature
 *
 * Tests the temperature delta cycling logic: each retry attempt gets a
 * different temperature so the model doesn't produce the same broken output.
 *
 * The delta formula from the source: deltas = [-TEMP_DELTA, TEMP_DELTA, 0]
 * Attempt 1 (index 0): lower temp (more deterministic)
 * Attempt 2 (index 1): raise temp (explore alternatives)
 * Attempt 3 (index 2): base temp
 * Cycle repeats every 3 attempts.
 */

import { test, expect } from "bun:test";

const TEMP_DELTA = 0.15;

/**
 * Pure function replicating the temperature logic from adaptive-temp.ts.
 * editCount: how many edit tool calls in recent messages.
 * baseTemp: current temperature (default 0.1).
 */
function computeTemperature(editCount: number, baseTemp = 0.1): number {
  if (editCount === 0) return baseTemp;

  const deltas = [-TEMP_DELTA, TEMP_DELTA, 0];
  const idx = (editCount - 1) % deltas.length;
  const delta = deltas[idx];

  return Math.max(0, Math.min(2, baseTemp + delta));
}

test("computeTemperature: 0 edits returns base temp", () => {
  expect(computeTemperature(0, 0.1)).toBe(0.1);
  expect(computeTemperature(0, 0.5)).toBe(0.5);
});

test("computeTemperature: attempt 1 lowers temperature (clamped to 0)", () => {
  // 0.1 - 0.15 = -0.05, clamped to 0
  const result = computeTemperature(1, 0.1);
  expect(result).toBe(0);
});

test("computeTemperature: attempt 2 raises temperature", () => {
  const result = computeTemperature(2, 0.1);
  expect(result).toBe(0.1 + TEMP_DELTA);
  expect(result).toBeGreaterThan(0.1);
});

test("computeTemperature: attempt 3 returns to base", () => {
  const result = computeTemperature(3, 0.1);
  expect(result).toBe(0.1);
});

test("computeTemperature: attempt 4 cycles back to lower (clamped to 0)", () => {
  const result = computeTemperature(4, 0.1);
  expect(result).toBe(0);
});

test("computeTemperature: attempt 5 cycles to higher (index 1)", () => {
  const result = computeTemperature(5, 0.1);
  expect(result).toBe(0.1 + TEMP_DELTA);
});

test("computeTemperature: attempt 6 cycles to base (index 2)", () => {
  const result = computeTemperature(6, 0.1);
  expect(result).toBe(0.1);
});

test("computeTemperature: clamps to minimum 0", () => {
  const result = computeTemperature(1, 0.0);
  // base 0 - 0.15 = -0.15 → clamped to 0
  expect(result).toBe(0);
});

test("computeTemperature: clamps to maximum 2", () => {
  const result = computeTemperature(2, 1.9);
  // base 1.9 + 0.15 = 2.05 → clamped to 2
  expect(result).toBe(2);
});

test("computeTemperature: works with different base temperatures", () => {
  expect(computeTemperature(1, 0.5)).toBe(0.5 - TEMP_DELTA); // 0.35
  expect(computeTemperature(2, 0.7)).toBe(0.7 + TEMP_DELTA); // 0.85
  expect(computeTemperature(3, 0.3)).toBe(0.3);              // 0.3
});

test("computeTemperature: high edit counts still cycle correctly", () => {
  // Attempt 7 → (7-1) % 3 = 0 → lower (clamped to 0)
  expect(computeTemperature(7, 0.1)).toBe(0);
  // Attempt 8 → (8-1) % 3 = 1 → raise
  expect(computeTemperature(8, 0.1)).toBe(0.1 + TEMP_DELTA);
  // Attempt 9 → (9-1) % 3 = 2 → base
  expect(computeTemperature(9, 0.1)).toBe(0.1);
});

test("computeTemperature: never returns NaN", () => {
  for (let i = 0; i <= 20; i++) {
    const t = computeTemperature(i);
    expect(Number.isNaN(t)).toBe(false);
    expect(t).toBeGreaterThanOrEqual(0);
    expect(t).toBeLessThanOrEqual(2);
  }
});
