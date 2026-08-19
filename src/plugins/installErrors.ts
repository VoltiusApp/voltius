import { PluginHashMismatchError } from "./integrity";
import { MinAppVersionError } from "./version";

/** A message named by its i18n key, so a caller can hold one across a locale change. */
export interface TranslatableMessage {
  key: string;
  params?: Record<string, string>;
}

/**
 * The user-facing message for a failed plugin install, matched on the error's
 * type rather than its text. A hash mismatch is the user's only tamper signal,
 * so it must never collapse into whatever generic failure the caller shows;
 * `fallbackKey` covers everything else.
 */
export function pluginInstallErrorMessage(e: unknown, fallbackKey: string): TranslatableMessage {
  if (e instanceof PluginHashMismatchError) return { key: "settings.plugins.install.integrityFailed" };
  if (e instanceof MinAppVersionError)
    return { key: "settings.plugins.install.versionUnsupported", params: { version: e.required } };
  return { key: fallbackKey };
}
