/**
 * Structured logging for the extension.
 *
 * Writes timestamped, level-tagged log lines to `.smallcode/sc-harness.log`.
 * Activated by setting `SMALLCODE_LOG_LEVEL` to `debug`, `info`, `warn`, or `error`.
 * Default: only `warn` and `error` are written.
 *
 * Usage:
 *   import { log } from "./log.ts";
 *   log.info("write-guard", "Blocked write to %s (unread)", filePath);
 */

import { appendFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_NUM: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function getThreshold(): number {
  const level = (process.env["SMALLCODE_LOG_LEVEL"] || "warn") as LogLevel;
  return LEVEL_NUM[level] ?? 2;
}

let _logDir = "";

export function setLogDir(dir: string): void {
  _logDir = dir;
  const logPath = join(dir, "sc-harness.log");
  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    // Truncate log on startup
    appendFileSync(logPath, "");
  } catch {
    // Non-fatal: logging degrades silently
  }
}

function write(level: LogLevel, module: string, message: string): void {
  if (LEVEL_NUM[level] < getThreshold()) return;
  if (!_logDir) return;

  const ts = new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm
  const line = `${ts} [${level.toUpperCase()}] [${module}] ${message}\n`;

  try {
    appendFileSync(join(_logDir, "sc-harness.log"), line);
  } catch {
    // Silent degradation
  }
}

export const log = {
  debug(module: string, msg: string, ...args: unknown[]): void {
    write("debug", module, args.length ? fmt(msg, args) : msg);
  },
  info(module: string, msg: string, ...args: unknown[]): void {
    write("info", module, args.length ? fmt(msg, args) : msg);
  },
  warn(module: string, msg: string, ...args: unknown[]): void {
    write("warn", module, args.length ? fmt(msg, args) : msg);
  },
  error(module: string, msg: string, ...args: unknown[]): void {
    write("error", module, args.length ? fmt(msg, args) : msg);
  },
};

function fmt(template: string, args: unknown[]): string {
  let i = 0;
  return template.replace(/%s/g, () => String(args[i++] ?? ""));
}
