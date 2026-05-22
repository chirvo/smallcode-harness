/**
 * Unit tests: Bootstrap Detector
 *
 * Tests the pure detection/formatting logic in isolation.
 * No pi API dependencies — pure function tests.
 */

import { test, expect } from "bun:test";
import { detectBootstrap, detectNodeFramework, formatBootstrap } from "../../src/bootstrap-detector.ts";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function withTempDir(fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "sc-test-"));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("detectBootstrap: Node.js with npm lockfile", () => {
  withTempDir((dir) => {
    writeFileSync(join(dir, "package.json"), JSON.stringify({
      name: "test",
      main: "index.js",
      scripts: { test: "jest", build: "tsc", start: "node index.js" },
    }));
    writeFileSync(join(dir, "package-lock.json"), "{}");

    const result = detectBootstrap(dir);
    expect(result.runtime).toBe("node");
    expect(result.packageManager).toBe("npm");
    expect(result.testCommand).toBe("jest");
    expect(result.buildCommand).toBe("tsc");
    expect(result.runCommand).toBe("node index.js");
    expect(result.entryPoint).toBe("index.js");
  });
});

test("detectBootstrap: pnpm from lockfile", () => {
  withTempDir((dir) => {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "test" }));
    writeFileSync(join(dir, "pnpm-lock.yaml"), "");
    expect(detectBootstrap(dir).packageManager).toBe("pnpm");
  });
});

test("detectBootstrap: Python project with pytest", () => {
  withTempDir((dir) => {
    writeFileSync(join(dir, "pyproject.toml"), '[tool.pytest]\n[project]\ndependencies = ["fastapi"]');
    const result = detectBootstrap(dir);
    expect(result.runtime).toBe("python");
    expect(result.testCommand).toBe("pytest");
  });
});

test("detectBootstrap: Rust project", () => {
  withTempDir((dir) => {
    writeFileSync(join(dir, "Cargo.toml"), '[package]\nname = "test"');
    const result = detectBootstrap(dir);
    expect(result.runtime).toBe("rust");
    expect(result.testCommand).toBe("cargo test");
    expect(result.buildCommand).toBe("cargo build");
    expect(result.runCommand).toBe("cargo run");
  });
});

test("detectBootstrap: Go project", () => {
  withTempDir((dir) => {
    writeFileSync(join(dir, "go.mod"), "module test\n\ngo 1.22");
    const result = detectBootstrap(dir);
    expect(result.runtime).toBe("go");
    expect(result.testCommand).toBe("go test ./...");
  });
});

test("detectBootstrap: empty directory returns null runtime", () => {
  withTempDir((dir) => {
    expect(detectBootstrap(dir).runtime).toBeNull();
  });
});

test("detectBootstrap: Node.js with Next.js framework detection", () => {
  withTempDir((dir) => {
    writeFileSync(join(dir, "package.json"), JSON.stringify({
      name: "test",
      dependencies: { next: "^14.0.0", react: "^18.0.0" },
      scripts: { dev: "next dev", build: "next build" },
    }));
    writeFileSync(join(dir, "package-lock.json"), "{}");
    expect(detectBootstrap(dir).framework).toBe("Next.js");
  });
});

test("detectNodeFramework: Next.js", () => {
  expect(detectNodeFramework({ dependencies: { next: "^14" } })).toBe("Next.js");
});

test("detectNodeFramework: Express", () => {
  expect(detectNodeFramework({ dependencies: { express: "^4" } })).toBe("Express");
});

test("detectNodeFramework: React with Vite", () => {
  expect(detectNodeFramework({ devDependencies: { react: "^18", vite: "^5" } })).toBe("React (Vite)");
});

test("detectNodeFramework: empty returns null", () => {
  expect(detectNodeFramework({})).toBeNull();
});

test("formatBootstrap: complete info", () => {
  const result = formatBootstrap({
    runtime: "node", version: "v20.11.0", packageManager: "pnpm",
    framework: "Next.js", entryPoint: "src/app/page.tsx",
    testCommand: "pnpm vitest run", buildCommand: "pnpm build", runCommand: "pnpm dev",
  });
  expect(result).toContain("[PROJECT BOOTSTRAP]");
  expect(result).toContain("Runtime: node v20.11.0");
  expect(result).toContain("Framework: Next.js");
  expect(result).toContain("Test: pnpm vitest run");
  expect(result).toContain("Run: pnpm dev");
});

test("formatBootstrap: null runtime returns null", () => {
  expect(formatBootstrap({
    runtime: null, version: null, packageManager: null,
    framework: null, entryPoint: null,
    testCommand: null, buildCommand: null, runCommand: null,
  })).toBeNull();
});
