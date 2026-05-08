// ─── Types ───────────────────────────────────────────────────────────────────

export type VarType = "text" | "number" | "password" | "boolean" | "choice";

export interface ParsedVariable {
  name: string;
  type: VarType;
  default?: string;
  label?: string;
  choices?: string[];
  dynamic: boolean;
}

export interface DynamicContext {
  connectionHost: string;
  connectionUsername: string;
  connectionName: string;
  clipboard?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DYNAMIC_VARS = new Set([
  "connection.host",
  "connection.username",
  "connection.name",
  "date",
  "datetime",
  "timestamp",
  "clipboard",
]);

const VALID_TYPES = new Set<VarType>(["text", "number", "password", "boolean", "choice"]);

// ─── Parse ───────────────────────────────────────────────────────────────────

/**
 * Parse all {{variable}} occurrences from a template.
 * Syntax: {{name}} or {{name:type}} or {{name:type:default}} or {{name:type:default|label}}
 * Dynamic variables (connection.host, date, etc.) are flagged but not prompted.
 * Duplicates are deduplicated by name.
 */
export function parseVariables(template: string): ParsedVariable[] {
  const regex = /\{\{([^}]+)\}\}/g;
  const seen = new Set<string>();
  const vars: ParsedVariable[] = [];

  for (const match of template.matchAll(regex)) {
    // Split label from the rest via |
    const [core, label] = match[1].split("|", 2);
    // Split core into at most 3 parts: name, type, default
    const parts = core.split(":", 3);
    const name = parts[0].trim();

    if (!name || seen.has(name)) continue;
    seen.add(name);

    if (DYNAMIC_VARS.has(name)) {
      vars.push({ name, type: "text", dynamic: true });
      continue;
    }

    const rawType = parts[1]?.trim() ?? "";
    const type: VarType = VALID_TYPES.has(rawType as VarType) ? (rawType as VarType) : "text";
    const rawDefault = parts[2]?.trim();
    const labelStr = label?.trim() || undefined;

    // For choice: rawDefault holds the comma-separated options list
    const choices =
      type === "choice"
        ? rawDefault?.split(",").map((c) => c.trim()).filter(Boolean)
        : undefined;

    // Default value: for choice = first choice, for others = rawDefault
    const defaultVal = type === "choice" ? choices?.[0] : rawDefault;

    vars.push({
      name,
      type,
      default: defaultVal,
      label: labelStr,
      choices,
      dynamic: false,
    });
  }

  return vars;
}

/**
 * Returns true if the variable requires explicit user input
 * (no resolvable default, or is a password which should never be auto-injected).
 */
export function needsUserInput(v: ParsedVariable): boolean {
  if (v.dynamic) return false;
  if (v.type === "password") return true;
  return v.default === undefined;
}

// ─── Resolve dynamic ─────────────────────────────────────────────────────────

function resolveDynamicVar(name: string, ctx: DynamicContext): string {
  switch (name) {
    case "connection.host": return ctx.connectionHost;
    case "connection.username": return ctx.connectionUsername;
    case "connection.name": return ctx.connectionName;
    case "date": {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    }
    case "datetime": {
      const d = new Date();
      return [
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
        `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`,
      ].join(" ");
    }
    case "timestamp": return String(Math.floor(Date.now() / 1000));
    case "clipboard": return ctx.clipboard ?? "";
    default: return `{{${name}}}`;
  }
}

// ─── Resolve template ─────────────────────────────────────────────────────────

/**
 * Replace all {{variable}} occurrences in a template with resolved values.
 * `values` maps variable name → resolved string.
 * Unresolved variables are left as-is.
 */
export function resolveTemplate(
  template: string,
  values: Record<string, string>,
): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (match, raw) => {
    const name = raw.split("|")[0].split(":")[0].trim();
    return name in values ? values[name] : match;
  });
}

/**
 * Build a values map for dynamic variables using the active session context.
 */
export function buildDynamicValues(
  vars: ParsedVariable[],
  ctx: DynamicContext,
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const v of vars) {
    if (v.dynamic) {
      values[v.name] = resolveDynamicVar(v.name, ctx);
    }
  }
  return values;
}

/**
 * Build initial values for user variables using their defaults.
 * Variables with no default are excluded (modal will prompt for them).
 */
export function buildDefaultValues(vars: ParsedVariable[]): Record<string, string> {
  const values: Record<string, string> = {};
  for (const v of vars) {
    if (!v.dynamic && v.default !== undefined && v.type !== "password") {
      values[v.name] = v.default;
    }
  }
  return values;
}
