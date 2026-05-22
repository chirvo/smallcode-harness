/**
 * Centralized configuration for smallcode-harness.
 *
 * All env vars are read through this module so there's a single source of truth.
 * Every option has a documented default and is toggleable at runtime.
 */

export interface HarnessConfig {
  /** Project bootstrap detection */
  bootstrap: boolean;
  /** Read-before-write guard */
  writeGuard: boolean;
  /** Early-stop detection (repetition, read-loop, patch-spiral) */
  earlyStop: boolean;
  /** Plan extraction + progress anchor */
  planAnchor: boolean;
  /** Bash error diagnosis */
  errorDiagnosis: boolean;
  /** Per-tool trust score decay */
  trustDecay: boolean;
  /** Adaptive retry temperature */
  adaptiveTemp: boolean;
  /** Patch semantic merge recovery */
  semanticMerge: boolean;
  /** Auto-validate after edits */
  autoValidate: boolean;
  /** Evidence store (cross-session memory) */
  evidence: boolean;
  /** Multi-file edit coordination header */
  multiFileEdit: boolean;
  /** Snapshot & auto-rollback */
  snapshot: boolean;
  /** Task decomposition on repeated failure */
  taskDecomposition: boolean;
  /** Structured log level: debug | info | warn | error */
  logLevel: string;
}

/**
 * Read all env vars with defaults. All use `SMALLCODE_*` prefix.
 * Strings "0", "false", "no", "off" (case-insensitive) → boolean false.
 */
export function loadConfig(overrides?: Partial<HarnessConfig>): HarnessConfig {
  const env = (key: string): string | undefined => process.env[key];

  // Map env var key to config property name (e.g. SMALLCODE_BOOTSTRAP → bootstrap)
  const envToConfigKey = (k: string): string => {
    return k.replace(/^SMALLCODE_/, "").toLowerCase()
      .replace(/_([a-z])/g, (_, c) => c.toUpperCase());
  };

  const bool = (key: string, def: boolean): boolean => {
    const configKey = envToConfigKey(key);
    if (overrides && configKey in overrides) return (overrides as Record<string, unknown>)[configKey] as boolean;
    const v = env(key);
    if (v === undefined || v === "") return def;
    return !["0", "false", "no", "off"].includes(v.toLowerCase());
  };

  return {
    bootstrap: bool("SMALLCODE_BOOTSTRAP", true),
    writeGuard: bool("SMALLCODE_WRITE_GUARD", true),
    earlyStop: bool("SMALLCODE_EARLY_STOP", true),
    planAnchor: bool("SMALLCODE_PLAN_ANCHOR", true),
    errorDiagnosis: bool("SMALLCODE_ERROR_DIAG", true),
    trustDecay: bool("SMALLCODE_TRUST_DECAY", true),
    adaptiveTemp: bool("SMALLCODE_ADAPTIVE_TEMP", true),
    semanticMerge: bool("SMALLCODE_SEMANTIC_MERGE", true),
    autoValidate: bool("SMALLCODE_AUTO_VALIDATE", true),
    evidence: bool("SMALLCODE_EVIDENCE", true),
    multiFileEdit: bool("SMALLCODE_MULTI_FILE_EDIT", true),
    snapshot: bool("SMALLCODE_SNAPSHOT", true),
    taskDecomposition: bool("SMALLCODE_DECOMPOSE", true),
    logLevel: env("SMALLCODE_LOG_LEVEL") || "warn",
  };
}

let _config: HarnessConfig | null = null;

/** Get the cached config (loaded once on first call). */
export function getConfig(): HarnessConfig {
  if (!_config) _config = loadConfig();
  return _config;
}

/** Reset config cache (useful for tests). */
export function resetConfig(): void {
  _config = null;
}
