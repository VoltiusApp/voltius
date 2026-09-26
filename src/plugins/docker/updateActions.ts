import type { PluginAPI, ToastOptions } from "@/plugins/api";
import { dockerUpdateImage } from "./services";
import { getDockerApi } from "./runtime";
import type { RecreateResult } from "./types";

type T = PluginAPI["i18n"]["t"];

/** Turn a recreate result into a single toast line + severity. */
export function summarizeRecreate(
  image: string,
  r: RecreateResult,
  t: T,
): { message: string; severity: "success" | "warning" } {
  const parts = [t("pulledImage", { image })];
  if (r.recreated.length) parts.push(t("recreatedCount", { count: r.recreated.length }));
  if (r.manual.length) parts.push(t("manualRecreateCount", { count: r.manual.length }));
  if (r.recreated.length === 0 && r.manual.length === 0) parts.push(t("summaryNoRunning"));
  return {
    message: parts.join(" · "),
    severity: r.manual.length > 0 ? "warning" : "success",
  };
}

/** The toast for a pull that went through. */
function pullOutcome(
  image: string,
  recreate: boolean,
  result: RecreateResult,
  t: T,
): ToastOptions & { message: string } {
  if (!recreate) {
    return {
      message: result.image_updated ? t("pulledImage", { image }) : t("alreadyUpToDate", { image }),
      severity: "info",
    };
  }
  if (!result.image_updated) {
    // Pull fetched nothing new — the image is current, or the registry was
    // unreachable / rate-limited. Surface docker's own output so the real
    // reason (e.g. "toomanyrequests", "Image is up to date") is visible.
    const message = result.pull_output
      ? t("noNewImageDocker", { image, output: result.pull_output })
      : t("noNewImage", { image });
    return { message, severity: "warning", duration: 10000 };
  }
  return summarizeRecreate(image, result, t);
}

/**
 * Pull `image` and, when `recreate` is set, recreate the containers using it.
 * Toasts the outcome, a failed pull included, and resolves whether the pull
 * went through (the caller resets its busy state either way).
 */
export async function pullAndMaybeRecreate(opts: {
  sessionId: string;
  isRemote: boolean;
  localShell: string | null;
  image: string;
  recreate: boolean;
}): Promise<boolean> {
  const { sessionId, isRemote, localShell, image, recreate } = opts;
  // Only the panel's rendered rows call this, after register() captured the api.
  const api = getDockerApi()!;
  const { t } = api.i18n;
  try {
    const result = await dockerUpdateImage({ sessionId, isRemote, localShell }, image, recreate);
    const { message, ...options } = pullOutcome(image, recreate, result, t);
    api.notifications.toast(message, options);
    return true;
  } catch (e) {
    api.notifications.toast(t("pullFailed", { error: String(e) }), { severity: "error" });
    return false;
  }
}
