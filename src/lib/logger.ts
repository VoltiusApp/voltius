import { info, warn, error, debug } from "@tauri-apps/plugin-log";

type Fwd = (message: string) => Promise<void>;

let verbose = false;

export function setLoggerVerbose(enabled: boolean): void {
  verbose = enabled;
}

export function getLoggerVerbose(): boolean {
  return verbose;
}

function fmt(msg: string, args: unknown[]): string {
  const extra = args.length
    ? " " + args.map((a) => (typeof a === "string" ? a : safeJson(a))).join(" ")
    : "";
  return `[fe] ${msg}${extra}`;
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function make(consoleMethod: "info" | "warn" | "error" | "debug", fwd: Fwd, gated = false) {
  return (msg: string, ...args: unknown[]) => {
    // Resolved at call time (not bound at import time) so console spies in tests work.
    console[consoleMethod](msg, ...args);
    if (gated && !verbose) return;
    // Fire-and-forget; never let logging throw into callers.
    void Promise.resolve(fwd(fmt(msg, args))).catch(() => {});
  };
}

export const log = {
  info: make("info", info),
  warn: make("warn", warn),
  error: make("error", error),
  debug: make("debug", debug, true),
};

let installed = false;

export function installGlobalErrorLogging(): void {
  if (installed) return;
  installed = true;
  window.addEventListener("error", (e) => {
    log.error(`uncaught error: ${e.message}`, e.filename ? `at ${e.filename}:${e.lineno}` : "");
    // Loaded here rather than at module scope: `log` and `logFailure` are
    // imported by services and stores that have no business pulling i18n and
    // the notification UI into their module graph (a partial `react-i18next`
    // mock in one panel test broke the moment they did).
    void (async () => {
      const [{ default: i18n }, { useNotificationStore }, { useUIStore }] = await Promise.all([
        import("@/i18n"),
        import("@/stores/notificationStore"),
        import("@/stores/uiStore"),
      ]);
      useNotificationStore.getState().addToast({
        source: { kind: "plugin", id: "core", name: "Voltius" },
        type: "toast",
        message: i18n.t("settings.diagnostics.toastGenericError"),
        severity: "error",
        duration: 8000,
        action: {
          label: i18n.t("settings.diagnostics.createButton"),
          onClick: () => useUIStore.getState().openSettings("diagnostics"),
        },
      });
    })();
  });
  window.addEventListener("unhandledrejection", (e) => {
    log.error("unhandled promise rejection", safeJson(e.reason));
  });
}

/**
 * Rejection handler for a promise that is deliberately not awaited. The caller
 * still must not die on the failure, but the failure must not vanish either:
 * `.catch(() => {})` left removal, sync and presence errors indistinguishable
 * from success and kept them out of bug reports entirely (issue #233).
 */
export function logFailure(context: string): (e: unknown) => void {
  return (e) => log.warn(`${context} failed:`, e instanceof Error ? e.message : safeJson(e));
}
