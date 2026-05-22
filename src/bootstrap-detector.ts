/**
 * Bootstrap Detector — Project Auto-Classification
 *
 * On first turn of a session, scans workspace and injects a compact project
 * summary: runtime + version, package manager, framework, test/run/build commands.
 *
 * Adapted from SmallCode's src/session/bootstrap.js — saves 3-5 tool calls
 * that small models waste discovering what kind of project they're in.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { BootstrapInfo, HarnessStateManager } from "./state.ts";

const ENV_KEY = "SMALLCODE_BOOTSTRAP";

function detectBootstrap(cwd: string): BootstrapInfo {
  const info: BootstrapInfo = {
    runtime: null,
    version: null,
    packageManager: null,
    framework: null,
    entryPoint: null,
    testCommand: null,
    buildCommand: null,
    runCommand: null,
  };

  // ── Node.js detection ──────────────────────────────────────────────────
  const pkgPath = join(cwd, "package.json");
  if (existsSync(pkgPath)) {
    info.runtime = "node";
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
      info.framework = detectNodeFramework(pkg);
      info.entryPoint = pkg.main || pkg.bin?.[0] || pkg.exports?.["."] || "index.js";
      info.testCommand = pkg.scripts?.test || null;
      info.buildCommand = pkg.scripts?.build || null;
      info.runCommand = pkg.scripts?.start || pkg.scripts?.dev || null;
    } catch {}
    // Detect package manager from lockfiles
    if (existsSync(join(cwd, "pnpm-lock.yaml"))) info.packageManager = "pnpm";
    else if (existsSync(join(cwd, "yarn.lock"))) info.packageManager = "yarn";
    else if (existsSync(join(cwd, "bun.lock")  ) || existsSync(join(cwd, "bun.lockb"))) info.packageManager = "bun";
    else if (existsSync(join(cwd, "package-lock.json"))) info.packageManager = "npm";
    // Node version
    try {
      const nodeVer = readFileSync(join(cwd, ".nvmrc") || join(cwd, ".node-version"), "utf-8").trim();
      info.version = nodeVer;
    } catch {}
    return info;
  }

  // ── Python detection ───────────────────────────────────────────────────
  if (existsSync(join(cwd, "pyproject.toml"))) {
    info.runtime = "python";
    try {
      const content = readFileSync(join(cwd, "pyproject.toml"), "utf-8");
      if (content.includes('"django"') || content.includes("django")) info.framework = "Django";
      else if (content.includes("fastapi") || content.includes("FastAPI")) info.framework = "FastAPI";
      else if (content.includes("flask") || content.includes("Flask")) info.framework = "Flask";
      if (content.includes("pytest")) info.testCommand = "pytest";
    } catch {}
    if (existsSync(join(cwd, "Pipfile"))) info.packageManager = "pipenv";
    else if (existsSync(join(cwd, "poetry.lock"))) info.packageManager = "poetry";
    else info.packageManager = "pip";
    info.runCommand = "python main.py";
    return info;
  }

  // ── Rust detection ────────────────────────────────────────────────────
  if (existsSync(join(cwd, "Cargo.toml"))) {
    info.runtime = "rust";
    info.testCommand = "cargo test";
    info.buildCommand = "cargo build";
    info.runCommand = "cargo run";
    return info;
  }

  // ── Go detection ───────────────────────────────────────────────────────
  if (existsSync(join(cwd, "go.mod"))) {
    info.runtime = "go";
    info.testCommand = "go test ./...";
    info.buildCommand = "go build ./...";
    // Try to find main entry
    for (const candidate of ["main.go", "cmd/main.go", "cmd/app/main.go"]) {
      if (existsSync(join(cwd, candidate))) {
        info.runCommand = `go run ./${candidate.replace(/\/[^/]+$/, "")}`;
        break;
      }
    }
    if (!info.runCommand) info.runCommand = "go run .";
    return info;
  }

  // ── Ruby detection ─────────────────────────────────────────────────────
  if (existsSync(join(cwd, "Gemfile"))) {
    info.runtime = "ruby";
    info.testCommand = existsSync(join(cwd, "spec")) ? "rspec" : "rake test";
    if (existsSync(join(cwd, "config", "application.rb"))) info.framework = "Rails";
    return info;
  }

  return info;
}

function detectNodeFramework(pkg: Record<string, unknown>): string | null {
  const deps: Record<string, string> = { ...(pkg.dependencies as Record<string, string> || {}), ...(pkg.devDependencies as Record<string, string> || {}) };
  const keys = Object.keys(deps);
  if (keys.includes("next")) return "Next.js";
  if (keys.includes("nuxt")) return "Nuxt";
  if (keys.includes("svelte") && keys.includes("vite")) return "SvelteKit";
  if (keys.includes("vue") && keys.includes("vite")) return "Vue (Vite)";
  if (keys.includes("vue")) return "Vue";
  if (keys.includes("react") && keys.includes("vite")) return "React (Vite)";
  if (keys.includes("react")) return "React";
  if (keys.includes("express") || keys.includes("fastify")) return keys.includes("express") ? "Express" : "Fastify";
  if (keys.includes("@nestjs/core")) return "NestJS";
  if (keys.includes("astro")) return "Astro";
  return null;
}

function formatBootstrap(info: BootstrapInfo): string | null {
  if (!info.runtime) return null;
  const lines: string[] = ["[PROJECT BOOTSTRAP]"];
  lines.push(`Runtime: ${info.runtime}${info.version ? ` ${info.version}` : ""}`);
  if (info.packageManager) lines.push(`Package manager: ${info.packageManager}`);
  if (info.framework) lines.push(`Framework: ${info.framework}`);
  if (info.entryPoint) lines.push(`Entry: ${info.entryPoint}`);
  if (info.testCommand) lines.push(`Test: ${info.testCommand}`);
  if (info.buildCommand) lines.push(`Build: ${info.buildCommand}`);
  if (info.runCommand) lines.push(`Run: ${info.runCommand}`);
  return lines.join("\n");
}

export function registerBootstrapDetector(pi: ExtensionAPI, state: HarnessStateManager): void {
  const enabled = process.env[ENV_KEY] !== "false";

  pi.on("session_start", (_event, ctx: ExtensionContext) => {
    if (!enabled || state.state.bootstrapDone) return;

    const detector = detectBootstrap(ctx.cwd);
    state.state.bootstrap = detector;
    state.state.bootstrapDone = true;
    state.flush();
  });

  pi.on("before_agent_start", (event, _ctx: ExtensionContext) => {
    if (!enabled || !state.state.bootstrap || state.state.bootstrapDone === false) return;
    state.state.bootstrapDone = true;
    // Only inject on the very first turn
    const formatted = formatBootstrap(state.state.bootstrap);
    if (formatted) {
      return {
        systemPrompt: event.systemPrompt + "\n\n" + formatted,
      };
    }
  });
}
