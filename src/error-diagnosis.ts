/**
 * Error Diagnosis — Bash Failure Analysis
 *
 * When a bash command exits non-zero, analyzes stderr to emit a structured
 * fix hint: error type, relevant file/line, and one-sentence suggestion.
 *
 * Uses pure regex (zero LLM calls — small models don't need an LLM to read
 * stderr, they need it translated into structured form).
 *
 * Adapted from SmallCode's bin/features_adapter.js (diagnoseError, Rank 4)
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { HarnessStateManager } from "./state.ts";

const ENV_KEY = "SMALLCODE_ERROR_DIAG";

interface Diagnosis {
  type: string;
  file: string | null;
  line: number | null;
  suggestion: string;
}

// ── Error Classifiers ─────────────────────────────────────────────────────────

const SYNTAX_PATTERNS: Array<{ re: RegExp; lang: string }> = [
  { re: /SyntaxError/, lang: "python/javascript" },
  { re: /Unexpected token/, lang: "javascript" },
  { re: /Parsing error/, lang: "general" },
  { re: /unexpected indent|IndentationError/, lang: "python" },
  { re: /NameError/, lang: "python" },
  { re: /ModuleNotFoundError|ImportError/, lang: "python" },
  { re: /TypeError:.*is not a function/, lang: "javascript" },
  { re: /cannot find module/i, lang: "node" },
  { re: /tsc:.*error TS\d+/, lang: "typescript" },
  { re: /error\[E\d+\]/, lang: "rust" },
  { re: /undefined reference/, lang: "c/c++/go" },
];

const NOT_FOUND_PATTERNS = [
  { re: /No such file or directory|ENOENT/, suggestion: "Check file path exists" },
  { re: /command not found/, suggestion: "Install the command or check spelling" },
  { re: /is not recognized/, suggestion: "Command not available on this platform" },
  { re: /cannot find the path/, suggestion: "Verify the directory path" },
];

const PERMISSION_PATTERNS = [
  { re: /Permission denied|EACCES/, suggestion: "Add execute permission or run with elevated privileges" },
  { re: /EACCESS/, suggestion: "Check file permissions" },
];

const TIMEOUT_PATTERNS = [
  { re: /timed? out/i, suggestion: "Command took too long — add a shorter timeout or reduce work" },
];

// Extract file:line from common error formats
const FILE_LINE_PATTERNS = [
  /File "([^"]+)", line (\d+)/,            // Python
  /at\s+(?:.*?\/)?([^/\s]+):(\d+):\d+/,   // JavaScript/TypeScript
  /(?:\.\/)?([\w./]+\.\w+)\s*\(\s*(\d+)/,  // General
  /([\w./]+\.\w+):(\d+):(\d+)/,            // Rust/tsc
];

export function classifyError(command: string, stderr: string, exitCode: number): Diagnosis {
  const full = `${command}\n${stderr}`;

  // Check timeout
  for (const p of TIMEOUT_PATTERNS) {
    if (p.re.test(full)) {
      return { type: "timeout", file: null, line: null, suggestion: p.suggestion };
    }
  }

  // Check not found
  for (const p of NOT_FOUND_PATTERNS) {
    if (p.re.test(stderr)) {
      return { type: "notfound", file: null, line: null, suggestion: p.suggestion };
    }
  }

  // Check permission
  for (const p of PERMISSION_PATTERNS) {
    if (p.re.test(stderr)) {
      return { type: "permission", file: null, line: null, suggestion: p.suggestion };
    }
  }

  // Extract file:line
  let file: string | null = null;
  let line: number | null = null;
  for (const p of FILE_LINE_PATTERNS) {
    const m = stderr.match(p);
    if (m) {
      file = m[1] || null;
      line = m[2] ? parseInt(m[2], 10) : null;
      break;
    }
  }

  // Check syntax errors
  for (const p of SYNTAX_PATTERNS) {
    if (p.re.test(stderr)) {
      const suggestion = file
        ? `Syntax error in ${file}${line ? `:${line}` : ""}. Fix the ${p.lang} syntax.`
        : `Fix the ${p.lang} syntax error.`;
      return { type: "syntax", file, line, suggestion };
    }
  }

  // Generic
  return {
    type: "unknown",
    file,
    line,
    suggestion: `Exit code ${exitCode}. ${file ? `Check ${file}${line ? `:${line}` : ""}` : "Check the command output for details."}`,
  };
}

export function registerErrorDiagnosis(pi: ExtensionAPI, state: HarnessStateManager): void {
  const enabled = process.env[ENV_KEY] !== "false";
  if (!enabled) return;

  pi.on("tool_result", (event, _ctx: ExtensionContext) => {
    if (event.toolName !== "bash") return;
    if (!event.isError) return;

    const input = event.input as { command?: string } | undefined;
    const stderr = extractStderr(event);
    const exitCode = (event.details as { exitCode?: number } | undefined)?.exitCode ?? 1;
    const command = input?.command ?? "";

    const diagnosis = classifyError(command, stderr, exitCode);
    const loc = diagnosis.file
      ? ` in ${diagnosis.file}${diagnosis.line ? `:${diagnosis.line}` : ""}`
      : "";

    const hint = `[ERROR-DIAGNOSIS] Type: ${diagnosis.type}${loc}. Fix: ${diagnosis.suggestion}`;

    // Prepend the diagnosis as first content block
    return {
      content: [
        { type: "text" as const, text: hint },
        ...(event.content ?? []),
      ],
    };
  });
}

function extractStderr(event: { content?: unknown; details?: unknown }): string {
  // Try details.stderr
  const details = event.details as { stderr?: string } | undefined;
  if (details?.stderr) return details.stderr;

  // Try content as string
  const content = event.content;
  if (typeof content === "string") return content;

  // Try content as array
  if (Array.isArray(content)) {
    return content
      .filter((c: { type?: string; text?: string }) => c.type === "text")
      .map((c: { text?: string }) => c.text || "")
      .join("\n");
  }

  return "";
}
