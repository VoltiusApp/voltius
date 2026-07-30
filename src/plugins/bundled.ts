/**
 * Plugins bundlés — importés statiquement au build.
 * Ajouter ici les imports de packages/plugin-* quand ils existeront.
 *
 * Format attendu :
 *   import { manifest, register } from "@voltius/plugin-ssh-config";
 *   export const BUNDLED_PLUGINS = [{ manifest, register }];
 */

import type { PluginManifest, PluginRegisterFn } from "./api";
import { manifest as dockerManifest, register as dockerRegister } from "./docker";

export interface BundledPlugin {
  manifest: PluginManifest;
  register: PluginRegisterFn;
}

export const BUNDLED_PLUGINS: BundledPlugin[] = [
  { manifest: dockerManifest, register: dockerRegister },
];
