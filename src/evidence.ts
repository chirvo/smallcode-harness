/**
 * Evidence Store — Cross-Session "What Worked, What Failed" Memory
 *
 * Captures "what was tried, what worked, what failed" per task and persists
 * it via pi.appendEntry so it surfaces on future similar tasks.
 *
 * Small models have no episodic memory. This gives them one: "last time
 * `npm test` hung without --run flag on this project."
 *
 * Adapted from SmallCode's src/memory/evidence.js
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { HarnessStateManager } from "./state.ts";
import { log } from "./log.ts";

const ENV_KEY = "SMALLCODE_EVIDENCE";
const EVIDENCE_CUSTOM_TYPE = "sc-harness-evidence";

interface EvidenceEntry {
  task: string;
  command: string;
  outcome: "success" | "failure";
  suggestion: string;
  file: string | null;
  timestamp: number;
}

/** Keep at most 50 evidence entries per session to avoid bloat */
const MAX_EVIDENCE = 50;

export function registerEvidenceStore(pi: ExtensionAPI, state: HarnessStateManager): void {
  const enabled = process.env[ENV_KEY] !== "false";
  if (!enabled) return;

  // Collect evidence from bash failures
  pi.on("tool_result", (event, _ctx: ExtensionContext) => {
    if (event.toolName !== "bash") return;

    const input = event.input as { command?: string } | undefined;
    const command = input?.command || "";
    if (!command) return;

    // Skip trivial commands
    if (command.length < 5) return;

    const stderr = extractStderr(event);
    const isError = event.isError ?? false;

    // Extract task hint from the message preceding this tool call
    const taskHint = command.slice(0, 60).replace(/\n/g, " ");

    if (isError) {
      const suggestion = generateSuggestion(command, stderr);
      const file = extractFile(stderr);
      const entry: EvidenceEntry = {
        task: taskHint,
        command: command.slice(0, 120),
        outcome: "failure",
        suggestion,
        file,
        timestamp: Date.now(),
      };
      saveEvidence(pi, entry);
      log.debug("evidence", "Recorded failure: %s → %s", taskHint, suggestion);
    } else if (isNotableSuccess(command, stderr)) {
      // Also record successful build/test commands
      const entry: EvidenceEntry = {
        task: taskHint,
        command: command.slice(0, 120),
        outcome: "success",
        suggestion: `${command} passed — this approach works for this project`,
        file: null,
        timestamp: Date.now(),
      };
      saveEvidence(pi, entry);
    }
  });

  // Inject relevant evidence into context at the start of each turn
  pi.on("before_agent_start", (event, _ctx: ExtensionContext) => {
    const evidence = loadEvidence();
    if (evidence.length === 0) return;

    // Find evidence relevant to the current task
    const prompt = event.prompt.toLowerCase();
    const relevant = evidence.filter((e) => {
      const words = e.command.toLowerCase().split(/\s+/).slice(0, 6);
      return words.some((w) => w.length > 3 && prompt.includes(w));
    });

    if (relevant.length === 0) return;

    const lines = relevant.map((e) => {
      const tag = e.outcome === "failure" ? "⚠" : "✓";
      return `${tag} [EVIDENCE] ${e.command} — ${e.suggestion}`;
    });

    return {
      systemPrompt: event.systemPrompt + "\n\n" + lines.join("\n"),
    };
  });
}

function isNotableSuccess(command: string, _output: string): boolean {
  const notable = /\b(build|test|lint|compile|install|deploy)\b/i;
  return notable.test(command);
}

function extractStderr(event: { content?: unknown; details?: unknown }): string {
  const details = event.details as { stderr?: string } | undefined;
  if (details?.stderr) return details.stderr;
  return typeof event.content === "string" ? event.content : "";
}

function extractFile(stderr: string): string | null {
  const m = stderr.match(/File "([^"]+)"/) || stderr.match(/at\s+(?:.*?\/)?([^/\s]+):\d+/);
  return m ? m[1] : null;
}

function generateSuggestion(command: string, stderr: string): string {
  const full = `${command}\n${stderr}`.toLowerCase();

  if (full.includes("command not found") || full.includes("not recognized")) {
    return `Install the required package or check spelling (${command.split(/\s+/)[0]} not found)`;
  }
  if (full.includes("permission denied")) {
    return `Add execute permission: chmod +x`;
  }
  if (full.includes("enoent") || full.includes("no such file")) return "Check the file path exists";
  if (full.includes("module not found") || full.includes("cannot find module")) {
    const m = stderr.match(/(?:cannot find module|module not found)\s+'([^']+)'/i);
    return `Install the missing dependency: ${m ? `npm install ${m[1]}` : "npm install <dependency>"}`;
  }
  if (full.includes("syntaxerror") || full.includes("unexpected token")) return "Fix the syntax error";
  if (full.includes("timed out")) return "Command timed out — increase timeout or simplify the command";

  return `Check the command and try again`;
}

/** Load evidence from all branch entries */
function loadEvidence(): EvidenceEntry[] {
  // Evidence is stored via pi.appendEntry. We read it back
  // by iterating session entries. This is handled by the persistence layer.
  // For now, we maintain an in-memory array that's saved to session.
  return _evidenceCache;
}

let _evidenceCache: EvidenceEntry[] = [];

function saveEvidence(pi: ExtensionAPI, entry: EvidenceEntry): void {
  _evidenceCache.push(entry);
  if (_evidenceCache.length > MAX_EVIDENCE) _evidenceCache.shift();
  try {
    pi.appendEntry(EVIDENCE_CUSTOM_TYPE, { evidence: _evidenceCache.slice(-10) });
  } catch {
    // Non-fatal
  }
}

/** Restore evidence cache from session entries (called on session_start) */
export function restoreEvidence(ctx: ExtensionContext): void {
  try {
    const entries = ctx.sessionManager.getBranch();
    for (const entry of entries) {
      if (entry.type === "custom" && entry.customType === EVIDENCE_CUSTOM_TYPE) {
        const data = entry.data as { evidence?: EvidenceEntry[] } | undefined;
        if (data?.evidence) {
          _evidenceCache.push(...data.evidence);
        }
      }
    }
    // Deduplicate by command + outcome
    const seen = new Set<string>();
    _evidenceCache = _evidenceCache.filter((e) => {
      const key = `${e.command}|${e.outcome}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    // Cap at MAX_EVIDENCE
    if (_evidenceCache.length > MAX_EVIDENCE) _evidenceCache = _evidenceCache.slice(-MAX_EVIDENCE);
  } catch {
    _evidenceCache = [];
  }
}
