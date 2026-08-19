import type { TFunction } from "i18next";
import { PluginHashMismatchError } from "./integrity";
import { MinAppVersionError } from "./version";

/**
 * The user-facing message for a failed plugin install, matched on the error's
 * type rather than its text. A hash mismatch is the user's only tamper signal,
 * so it must never collapse into whatever generic failure the caller shows;
 * `fallbackKey` covers everything else.
 */
export function pluginInstallErrorMessage(e: unknown, t: TFunction, fallbackKey: string): string {
  if (e instanceof PluginHashMismatchError) return t("settings.plugins.install.integrityFailed");
  if (e instanceof MinAppVersionError)
    return t("settings.plugins.install.versionUnsupported", { version: e.required });
  return t(fallbackKey);
}
