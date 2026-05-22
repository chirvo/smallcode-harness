/**
 * Multi-File Edit Coordination
 *
 * When the model edits 3+ files in a single turn, injects a coordination
 * header listing all files that need changes. Prevents small models from
 * forgetting file 3 while editing file 2.
 *
 * Adapted from SmallCode's src/compiled/features/multi_file_edit.js (Rank 6)
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { log } from "./log.ts";

const ENV_KEY = "SMALLCODE_MULTI_FILE_EDIT";

export function registerMultiFileEdit(pi: ExtensionAPI): void {
  const enabled = process.env[ENV_KEY] !== "false";
  if (!enabled) return;

  // Track files edited this turn
  let editedFilesInTurn: string[] = [];
  let injectedThisTurn = false;

  pi.on("turn_start", () => {
    editedFilesInTurn = [];
    injectedThisTurn = false;
  });

  pi.on("tool_call", (event, _ctx: ExtensionContext) => {
    const tool = event.toolName as string;
    if (tool !== "write" && tool !== "edit") return;

    const input = event.input as Record<string, unknown>;
    const path = input?.path as string | undefined;
    if (!path) return;

    // Track the file being edited
    if (!editedFilesInTurn.includes(path)) {
      editedFilesInTurn.push(path);
    }

    // Only inject when we hit 3+ files and haven't already injected
    if (editedFilesInTurn.length >= 3 && !injectedThisTurn) {
      injectedThisTurn = true;

      const header = buildMultiFileHeader(editedFilesInTurn);

      pi.sendMessage({
        customType: "sc-harness-coordination",
        content: header,
        display: true,
      }, { deliverAs: "steer" });

      log.info("multi-file-edit", "Injected coordination header for %d files", editedFilesInTurn.length);
    }
  });
}

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
