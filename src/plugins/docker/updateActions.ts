import { dockerUpdateImage } from "./services";
import { getDockerApi } from "./runtime";
import type { RecreateResult } from "./types";

/** Turn a recreate result into a single toast line + severity. */
export function summarizeRecreate(
  image: string,
  r: RecreateResult,
): { message: string; severity: "success" | "warning" } {
  const parts = [`Pulled ${image}`];
  if (r.recreated.length) parts.push(`recreated ${r.recreated.length}`);
  if (r.manual.length) parts.push(`${r.manual.length} need manual recreation`);
  if (r.recreated.length === 0 && r.manual.length === 0) parts.push("no running containers");
  return {
    message: parts.join(" · "),
    severity: r.manual.length > 0 ? "warning" : "success",
  };
}

/**
 * Pull `image` and, when `recreate` is set, recreate the containers using it.
 * Emits a result toast. Throws on pull failure (caller resets its busy state).
 */
export async function pullAndMaybeRecreate(opts: {
  sessionId: string;
  isRemote: boolean;
  localShell: string | null;
  image: string;
  recreate: boolean;
}): Promise<void> {
  const { sessionId, isRemote, localShell, image, recreate } = opts;
  const result = await dockerUpdateImage(sessionId, isRemote, localShell, image, recreate);
  const api = getDockerApi();

  if (!recreate) {
    api?.notifications.toast(
      result.image_updated ? `Pulled ${image}` : `${image} is already up to date`,
      { severity: "info" },
    );
    return;
  }

  if (!result.image_updated) {
    // Pull fetched nothing new — the image is current, or the registry was
    // unreachable / rate-limited. Surface docker's own output so the real
    // reason (e.g. "toomanyrequests", "Image is up to date") is visible.
    const detail = result.pull_output ? ` — docker: ${result.pull_output}` : "";
    api?.notifications.toast(`${image}: no new image pulled${detail}`, {
      severity: "warning",
      duration: 10000,
    });
    return;
  }

  const { message, severity } = summarizeRecreate(image, result);
  api?.notifications.toast(message, { severity });
}
