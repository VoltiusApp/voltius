import { PluginHashMismatchError } from "./integrity";
import { MinAppVersionError } from "./version";

/** A message named by its i18n key, so a caller can hold one across a locale change. */
export interface TranslatableMessage {
  key: string;
  params?: Record<string, string>;
}

/** Raised when an install is requested for an id whose install is still running.
 *  The second request is refused rather than joined: the two callers may have
 *  reviewed different manifests for the same id, so the running install cannot
 *  stand in for the one this caller consented to. */
export class PluginInstallInProgressError extends Error {
  constructor(public readonly id: string) {
    super(`An install of "${id}" is already in progress.`);
    this.name = "PluginInstallInProgressError";
  }
}

/**
 * The user-facing message for a failed plugin install, matched on the error's
 * type rather than its text. A hash mismatch is the user's only tamper signal,
 * so it must never collapse into whatever generic failure the caller shows;
 * `fallbackKey` covers everything else.
 */
export function pluginInstallErrorMessage(e: unknown, fallbackKey: string): TranslatableMessage {
  if (e instanceof PluginHashMismatchError) return { key: "settings.plugins.install.integrityFailed" };
  if (e instanceof PluginInstallInProgressError) return { key: "settings.plugins.install.alreadyInstalling" };
  if (e instanceof MinAppVersionError)
    return { key: "settings.plugins.install.versionUnsupported", params: { version: e.required } };
  return { key: fallbackKey };
}
