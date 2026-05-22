/**
 * Snapshot & Auto-Rollback
 *
 * Before each agent turn, snapshot file state. Every write/edit records its
 * pre-edit content. If validation hard-fails, auto-rollback reverts all edits
 * in the turn back to checkpoint (pre-turn) state.
 *
 * Adapted from SmallCode's src/session/snapshot.js
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from "node:fs";
import { resolve, dirname, relative } from "node:path";
import { log } from "./log.ts";

const ENV_KEY = "SMALLCODE_SNAPSHOT";

interface SnapshotFile {
  before: string | null;     // null = file didn't exist
  existed: boolean;
}

interface Checkpoint {
  id: string;
  label: string;
  files: Map<string, SnapshotFile>;
}

let activeCheckpoint: Checkpoint | null = null;
let workdir = "";

/** Reset checkpoint between agent runs */
function resetCheckpoint(): void {
  activeCheckpoint = null;
}

export function registerSnapshot(pi: ExtensionAPI): void {
  const enabled = process.env[ENV_KEY] !== "false";
  if (!enabled) return;

  pi.on("session_start", (_event, ctx: ExtensionContext) => {
    workdir = ctx.cwd;
  });

  // Open a checkpoint at the start of each turn
  pi.on("turn_start", () => {
    resetCheckpoint();
    const id = Math.random().toString(36).slice(2, 10);
    activeCheckpoint = {
      id,
      label: `turn-${Date.now()}`,
      files: new Map(),
    };
    log.debug("snapshot", "Checkpoint opened: %s", id);
  });

  // Snapshot file content before write/edit
  pi.on("tool_call", (event, ctx: ExtensionContext) => {
    const tool = event.toolName as string;
    if (tool !== "write" && tool !== "edit") return;
    if (!activeCheckpoint) return;

    // Re-read to get the state before this tool call
    workdir = ctx.cwd;
  });

  // Snapshot happens on tool_result (after the tool runs we can't undo,
  // so we snapshot BEFORE — on the tool_call event for write/edit)
  // But we also need to track what was changed.

  pi.on("tool_execution_start", (event, _ctx: ExtensionContext) => {
    const toolName = event.toolName as string;
    if (toolName !== "write" && toolName !== "edit") return;
    if (!activeCheckpoint) return;

    const args = event.args as Record<string, unknown> | undefined;
    const path = args?.path as string | undefined;
    if (!path) return;

    const fullPath = resolve(workdir, path);
    // Containment check — only snapshot files inside workspace
    const rel = relative(workdir, fullPath);
    if (rel.startsWith("..") || rel.startsWith("/")) return;

    // Don't overwrite an existing snapshot (first-snapshot-wins)
    if (activeCheckpoint.files.has(fullPath)) return;

    let before: string | null = null;
    let existed = false;

    try {
      if (existsSync(fullPath)) {
        before = readFileSync(fullPath, "utf-8");
        existed = true;
      }
    } catch {
      // Read error — skip snapshot for this file
      return;
    }

    activeCheckpoint.files.set(fullPath, { before, existed });
    log.debug("snapshot", "Snapshotted: %s (existed=%s)", path, existed);
  });

  // Close checkpoint cleanly on turn end
  pi.on("turn_end", () => {
    if (activeCheckpoint) {
      log.debug("snapshot", "Checkpoint committed: %s (%d files)", activeCheckpoint.id, activeCheckpoint.files.size);
    }
    resetCheckpoint();
  });
}

/**
 * Rollback all files in the active checkpoint to their pre-turn state.
 * Called externally when validation fails.
 */
export function rollback(reason: string): { restored: number; deleted: number; errors: string[] } {
  if (!activeCheckpoint) return { restored: 0, deleted: 0, errors: [] };

  const errors: string[] = [];
  let restored = 0;
  let deleted = 0;

  for (const [abs, snap] of activeCheckpoint.files.entries()) {
    try {
      if (snap.existed && snap.before !== null) {
        // Restore original content
        const dir = dirname(abs);
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        writeFileSync(abs, snap.before, "utf-8");
        restored++;
        log.info("snapshot", "Rolled back: %s", abs);
      } else if (!snap.existed) {
        // File was new in this turn — delete it
        if (existsSync(abs)) {
          unlinkSync(abs);
          deleted++;
          log.info("snapshot", "Deleted (was new): %s", abs);
        }
      }
    } catch (e) {
      errors.push(`${abs}: ${String(e)}`);
      log.error("snapshot", "Rollback failed for %s: %s", abs, String(e));
    }
  }

  activeCheckpoint = null;
  return { restored, deleted, errors };
}

/** Check if a checkpoint is active */
export function hasActiveCheckpoint(): boolean {
  return activeCheckpoint !== null;
}
