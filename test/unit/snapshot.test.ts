/**
 * Unit tests: Snapshot & Auto-Rollback
 *
 * Tests the core checkpoint logic: snapshot files, commit, rollback.
 */

import { test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Inline test harness for snapshot logic
interface SnapshotFile {
  before: string | null;
  existed: boolean;
}

class TestCheckpoint {
  files = new Map<string, SnapshotFile>();
  workdir: string;

  constructor(workdir: string) {
    this.workdir = workdir;
  }

  snapshot(absPath: string): void {
    if (!absPath.startsWith(this.workdir)) return; // containment
    if (this.files.has(absPath)) return; // first-snapshot-wins

    let before: string | null = null;
    let existed = false;
    try {
      if (existsSync(absPath)) {
        before = readFileSync(absPath, "utf-8");
        existed = true;
      }
    } catch {
      return;
    }
    this.files.set(absPath, { before, existed });
  }

  rollback(): { restored: number; deleted: number; errors: string[] } {
    const errors: string[] = [];
    let restored = 0;
    let deleted = 0;

    for (const [abs, snap] of this.files.entries()) {
      try {
        if (snap.existed && snap.before !== null) {
          writeFileSync(abs, snap.before, "utf-8");
          restored++;
        } else if (!snap.existed && existsSync(abs)) {
          rmSync(abs);
          deleted++;
        }
      } catch (e) {
        errors.push(`${abs}: ${String(e)}`);
      }
    }
    this.files.clear();
    return { restored, deleted, errors };
  }

  commit(): void {
    this.files.clear();
  }
}

const DIR = mkdtempSync(join(tmpdir(), "sc-ss-"));
let cp: TestCheckpoint;

beforeAll(() => {
  mkdirSync(join(DIR, "sub"), { recursive: true });
});

afterAll(() => {
  rmSync(DIR, { recursive: true, force: true });
});

test("checkpoint: snapshots existing file content", () => {
  cp = new TestCheckpoint(DIR);
  writeFileSync(join(DIR, "a.txt"), "original content");
  cp.snapshot(join(DIR, "a.txt"));
  const file = cp.files.get(join(DIR, "a.txt"));
  expect(file?.before).toBe("original content");
  expect(file?.existed).toBe(true);
});

test("checkpoint: snapshots non-existent file", () => {
  cp = new TestCheckpoint(DIR);
  const path = join(DIR, "new.txt");
  expect(existsSync(path)).toBe(false);
  cp.snapshot(path);
  const file = cp.files.get(path);
  expect(file?.before).toBeNull();
  expect(file?.existed).toBe(false);
});

test("checkpoint: first-snapshot-wins on duplicate", () => {
  cp = new TestCheckpoint(DIR);
  writeFileSync(join(DIR, "dup.txt"), "version 1");
  cp.snapshot(join(DIR, "dup.txt"));
  writeFileSync(join(DIR, "dup.txt"), "version 2");
  cp.snapshot(join(DIR, "dup.txt")); // duplicate — should be ignored
  expect(cp.files.size).toBe(1);
  expect(cp.files.get(join(DIR, "dup.txt"))?.before).toBe("version 1");
});

test("checkpoint: containment check blocks outside workspace", () => {
  cp = new TestCheckpoint(DIR);
  const outside = "/tmp/outside.txt";
  cp.snapshot(outside);
  expect(cp.files.has(outside)).toBe(false);
});

test("rollback: restores existing file to original content", () => {
  cp = new TestCheckpoint(DIR);
  writeFileSync(join(DIR, "rb.txt"), "original");
  cp.snapshot(join(DIR, "rb.txt"));
  writeFileSync(join(DIR, "rb.txt"), "modified");
  const result = cp.rollback();
  expect(result.restored).toBe(1);
  expect(result.deleted).toBe(0);
  expect(result.errors).toHaveLength(0);
  expect(readFileSync(join(DIR, "rb.txt"), "utf-8")).toBe("original");
});

test("rollback: deletes new file that didn't exist at snapshot time", () => {
  cp = new TestCheckpoint(DIR);
  const path = join(DIR, "will-delete.txt");
  cp.snapshot(path);
  writeFileSync(path, "i am new");
  expect(existsSync(path)).toBe(true);
  const result = cp.rollback();
  expect(result.restored).toBe(0);
  expect(result.deleted).toBe(1);
  expect(existsSync(path)).toBe(false);
});

test("commit: discards checkpoint without restoring", () => {
  cp = new TestCheckpoint(DIR);
  writeFileSync(join(DIR, "commit.txt"), "before");
  cp.snapshot(join(DIR, "commit.txt"));
  writeFileSync(join(DIR, "commit.txt"), "after");
  cp.commit();
  expect(cp.files.size).toBe(0);
  expect(readFileSync(join(DIR, "commit.txt"), "utf-8")).toBe("after");
});

test("rollback: multiple files", () => {
  cp = new TestCheckpoint(DIR);
  writeFileSync(join(DIR, "f1.txt"), "one");
  writeFileSync(join(DIR, "f2.txt"), "two");
  writeFileSync(join(DIR, "sub/f3.txt"), "three");
  cp.snapshot(join(DIR, "f1.txt"));
  cp.snapshot(join(DIR, "f2.txt"));
  cp.snapshot(join(DIR, "sub/f3.txt"));
  writeFileSync(join(DIR, "f1.txt"), "MODIFIED");
  writeFileSync(join(DIR, "f2.txt"), "MODIFIED");
  rmSync(join(DIR, "sub/f3.txt"));

  // f3.txt was deleted but existed at snapshot time — it gets restored, not deleted
  const result = cp.rollback();
  expect(result.restored).toBe(3);
  expect(result.deleted).toBe(0);
  expect(readFileSync(join(DIR, "f1.txt"), "utf-8")).toBe("one");
  expect(readFileSync(join(DIR, "f2.txt"), "utf-8")).toBe("two");
  expect(existsSync(join(DIR, "sub/f3.txt"))).toBe(true);
});
