/**
 * Shared session state for SmallCode Harness.
 * Persisted via pi.appendEntry() so it survives /reload and session restores.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

export interface BootstrapInfo {
  runtime: string | null;
  version: string | null;
  packageManager: string | null;
  framework: string | null;
  entryPoint: string | null;
  testCommand: string | null;
  buildCommand: string | null;
  runCommand: string | null;
}

export interface PlanState {
  steps: string[];
  currentStep: number;
  completed: number[];
}

export interface ToolTrust {
  consecutiveFailures: number;
  totalCalls: number;
}

export interface HarnessState {
  readFiles: string[];
  writtenFiles: string[];
  bootstrap: BootstrapInfo | null;
  bootstrapDone: boolean;
  plan: PlanState | null;
  planExtracted: boolean;
  toolTrust: Record<string, ToolTrust>;
  patchFailures: Record<string, number>;
  patchAttempts: Record<string, number>;
  readOnlyStreak: number;
  improvementAttempts: Record<string, number>;
  currentTurn: number;
}

const STATE_CUSTOM_TYPE = "sc-harness-state";
const MAX_STATE_ENTRIES = 50;

function freshState(): HarnessState {
  return {
    readFiles: [],
    writtenFiles: [],
    bootstrap: null,
    bootstrapDone: false,
    plan: null,
    planExtracted: false,
    toolTrust: {},
    patchFailures: {},
    patchAttempts: {},
    readOnlyStreak: 0,
    improvementAttempts: {},
    currentTurn: 0,
  };
}

const READ_TOOLS = new Set(["read", "grep", "find", "ls", "search"]);
const WRITE_TOOLS = new Set(["write", "edit"]);

export class HarnessStateManager {
  private _state: HarnessState;
  private _pi: ExtensionAPI;
  private _dirty = false;

  constructor(pi: ExtensionAPI) {
    this._pi = pi;
    this._state = freshState();

    // Restore from session on reload
    pi.on("session_start", (_event, ctx: ExtensionContext) => {
      this.restoreFromBranch(ctx);
    });
  }

  get state(): HarnessState {
    return this._state;
  }

  isReadTool(name: string): boolean {
    return READ_TOOLS.has(name);
  }

  isWriteTool(name: string): boolean {
    return WRITE_TOOLS.has(name);
  }

  recordRead(path: string): void {
    if (!this._state.readFiles.includes(path)) {
      this._state.readFiles.push(path);
      this._dirty = true;
    }
  }

  hasRead(path: string): boolean {
    return this._state.readFiles.includes(path);
  }

  recordWrite(path: string): void {
    if (!this._state.writtenFiles.includes(path)) {
      this._state.writtenFiles.push(path);
      this._dirty = true;
    }
  }

  hasWritten(path: string): boolean {
    return this._state.writtenFiles.includes(path);
  }

  recordPatchFailure(filePath: string): number {
    this._state.patchFailures[filePath] = (this._state.patchFailures[filePath] || 0) + 1;
    this._state.patchAttempts[filePath] = (this._state.patchAttempts[filePath] || 0) + 1;
    this._dirty = true;
    return this._state.patchFailures[filePath];
  }

  recordPatchSuccess(filePath: string): void {
    const prev = this._state.patchFailures[filePath] || 0;
    this._state.patchFailures[filePath] = Math.max(0, prev - 1);
    this._state.patchAttempts[filePath] = (this._state.patchAttempts[filePath] || 0) + 1;
    this._dirty = true;
  }

  getPatchFailures(filePath: string): number {
    return this._state.patchFailures[filePath] || 0;
  }

  getPatchAttempts(filePath: string): number {
    return this._state.patchAttempts[filePath] || 0;
  }

  incrementReadStreak(): number {
    this._state.readOnlyStreak++;
    this._dirty = true;
    return this._state.readOnlyStreak;
  }

  resetReadStreak(): void {
    this._state.readOnlyStreak = 0;
    this._dirty = true;
  }

  getReadStreak(): number {
    return this._state.readOnlyStreak;
  }

  recordToolSuccess(toolName: string): void {
    const t = this.getOrCreateTrust(toolName);
    t.consecutiveFailures = 0;
    t.totalCalls++;
    this._dirty = true;
  }

  recordToolFailure(toolName: string): number {
    const t = this.getOrCreateTrust(toolName);
    t.consecutiveFailures++;
    t.totalCalls++;
    this._dirty = true;
    return t.consecutiveFailures;
  }

  getTrust(toolName: string): ToolTrust {
    return this.getOrCreateTrust(toolName);
  }

  getImprovementAttempts(filePath: string): number {
    return this._state.improvementAttempts[filePath] || 0;
  }

  incrementImprovementAttempts(filePath: string): number {
    const n = (this._state.improvementAttempts[filePath] || 0) + 1;
    this._state.improvementAttempts[filePath] = n;
    this._dirty = true;
    return n;
  }

  newTurn(): void {
    this._state.currentTurn++;
    this._state.patchFailures = {};
    this._state.patchAttempts = {};
    this._state.readOnlyStreak = 0;
    this._dirty = true;
    this.flush();
  }

  /** Persist state to session via pi.appendEntry */
  flush(): void {
    if (!this._dirty) return;
    this._dirty = false;
    // Serialize — convert Maps/Sets to plain objects
    const serializable: HarnessState = {
      ...this._state,
    };
    try {
      this._pi.appendEntry(STATE_CUSTOM_TYPE, serializable as unknown as Record<string, unknown>);
    } catch {
      // Non-fatal: graceful degradation if session is unavailable
    }
  }

  /** Restore state from the last entry in the current branch */
  private restoreFromBranch(ctx: ExtensionContext): void {
    try {
      const entries = ctx.sessionManager.getBranch();
      let latest: HarnessState | null = null;
      for (const entry of entries) {
        if (entry.type === "custom" && entry.customType === STATE_CUSTOM_TYPE) {
          latest = entry.data as unknown as HarnessState;
        }
      }
      if (latest) {
        this._state = {
          ...freshState(),
          ...latest,
        };
      }
    } catch {
      // Non-fatal: start fresh
    }
  }

  private getOrCreateTrust(toolName: string): ToolTrust {
    if (!this._state.toolTrust[toolName]) {
      this._state.toolTrust[toolName] = { consecutiveFailures: 0, totalCalls: 0 };
    }
    return this._state.toolTrust[toolName];
  }
}
