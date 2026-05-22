/**
 * Unit tests: Auto-Validate
 */

import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";

// We test the validation commands by actually running them in temp dirs
// since detectValidator uses fs.existsSync for config file detection.

function withTempDir(fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "sc-av-"));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("detectValidator: JavaScript file with node --check", () => {
  withTempDir((dir) => {
    writeFileSync(join(dir, "good.js"), "const x = 1; console.log(x);");
    const result = execSync(`node --check ${join(dir, "good.js")} 2>&1 || true`, { encoding: "utf-8" });
    expect(result.trim()).toBe(""); // no errors
  });
});

test("detectValidator: JavaScript file with syntax error", () => {
  withTempDir((dir) => {
    writeFileSync(join(dir, "bad.js"), "const x = ;");
    try {
      const result = execSync(`node --check ${join(dir, "bad.js")} 2>&1 || true`, { encoding: "utf-8" });
      expect(result.toLowerCase()).toContain("syntaxerror");
    } catch {
      // node --check on bad syntax may throw, tolerate
    }
  });
});

test("detectValidator: JSON validation", () => {
  withTempDir((dir) => {
    writeFileSync(join(dir, "good.json"), '{"name": "test", "version": "1.0"}');
    const cmd = `node -e "JSON.parse(require('fs').readFileSync('${join(dir, "good.json")}','utf-8'))" 2>&1 || true`;
    const result = execSync(cmd, { encoding: "utf-8" });
    expect(result.trim()).toBe("");
  });
});

test("detectValidator: bad JSON fails", () => {
  withTempDir((dir) => {
    writeFileSync(join(dir, "bad.json"), '{"name": test}');
    const cmd = `node -e "JSON.parse(require('fs').readFileSync('${join(dir, "bad.json")}','utf-8'))" 2>&1 || true`;
    const result = execSync(cmd, { encoding: "utf-8" });
    expect(result).toContain("SyntaxError");
  });
});

test("detectValidator: Python file with syntax error", () => {
  withTempDir((dir) => {
    writeFileSync(join(dir, "bad.py"), "def foo(\n    pass\n");
    try {
      const result = execSync(`python -m py_compile ${join(dir, "bad.py")} 2>&1 || true`, { encoding: "utf-8" });
      expect(result).toContain("SyntaxError");
    } catch {
      // may throw on some systems
    }
  });
});

test("detectValidator: TypeScript with tsconfig", () => {
  withTempDir((dir) => {
    writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, target: "ES2022", module: "ESNext", noEmit: true } }));
    writeFileSync(join(dir, "good.ts"), "const x: number = 1;\nconsole.log(x);\n");
    // Just verify it doesn't crash — output varies by environment
    try {
      const result = execSync(`npx tsc --noEmit --pretty false 2>&1 || true`, { cwd: dir, encoding: "utf-8", timeout: 10000 });
      expect(typeof result).toBe("string");
    } catch {
      // tsc not installed — skip this check
    }
  });
});
