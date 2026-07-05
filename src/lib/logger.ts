import { info, warn, error, debug } from "@tauri-apps/plugin-log";
import i18n from "@/i18n";
import { useNotificationStore } from "@/stores/notificationStore";
import { useUIStore } from "@/stores/uiStore";

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

let invokeTimingInstalled = false;

/**
 * DIAGNOSTIC: wrap Tauri's internal invoke so any command slower than
 * `thresholdMs` is logged by name. Catches a single command that stalls the
 * IPC/main thread (which otherwise only shows up as an unrelated queued call).
 */
export function installInvokeTiming(thresholdMs = 1000): void {
  if (invokeTimingInstalled) return;
  const w = window as unknown as {
    __TAURI_INTERNALS__?: { invoke?: (...a: unknown[]) => unknown; __voltiusTimed?: boolean };
  };
  const internals = w.__TAURI_INTERNALS__;
  if (!internals || typeof internals.invoke !== "function") {
    // Injected before app scripts normally, but retry a few times just in case.
    if (installInvokeTimingRetries++ < 20) setTimeout(() => installInvokeTiming(thresholdMs), 50);
    return;
  }
  if (internals.__voltiusTimed) return;
  internals.__voltiusTimed = true;
  invokeTimingInstalled = true;
  const orig = internals.invoke.bind(internals);
  internals.invoke = (cmd: unknown, ...rest: unknown[]) => {
    const t0 = performance.now();
    const done = () => {
      const dt = performance.now() - t0;
      if (dt >= thresholdMs) log.info(`[perf] slow-invoke cmd=${String(cmd)} ${dt.toFixed(0)}ms`);
    };
    let result: unknown;
    try {
      result = orig(cmd, ...rest);
    } catch (e) {
      done();
      throw e;
    }
    if (result && typeof (result as Promise<unknown>).then === "function") {
      return (result as Promise<unknown>).finally(done);
    }
    done();
    return result;
  };
}
let installInvokeTimingRetries = 0;

let installed = false;

export function installGlobalErrorLogging(): void {
  if (installed) return;
  installed = true;
  window.addEventListener("error", (e) => {
    log.error(`uncaught error: ${e.message}`, e.filename ? `at ${e.filename}:${e.lineno}` : "");
    useNotificationStore.getState().addToast({
      pluginId: "core",
      pluginName: "Voltius",
      type: "toast",
      message: i18n.t("settings.diagnostics.toastGenericError"),
      severity: "error",
      duration: 8000,
      action: {
        label: i18n.t("settings.diagnostics.createButton"),
        onClick: () => useUIStore.getState().openSettings("diagnostics"),
      },
    });
  });
  window.addEventListener("unhandledrejection", (e) => {
    log.error("unhandled promise rejection", safeJson(e.reason));
  });
}
