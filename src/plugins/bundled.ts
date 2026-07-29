/**
 * Plugins bundlés — importés statiquement au build.
 * Ajouter ici les imports de packages/plugin-* quand ils existeront.
 *
 * Format attendu :
 *   import { manifest, register } from "@voltius/plugin-ssh-config";
 *   export const BUNDLED_PLUGINS = [{ manifest, register }];
 */

import type { PluginManifest, PluginRegisterFn } from "./api";
import { manifest as gistSyncManifest, register as gistSyncRegister } from "./gist-sync";
import { manifest as dockerManifest, register as dockerRegister } from "./docker";
import { manifest as proxmoxManifest, register as proxmoxRegister } from "./proxmox";

export interface BundledPlugin {
  manifest: PluginManifest;
  register: PluginRegisterFn;
}

export const BUNDLED_PLUGINS: BundledPlugin[] = [
  { manifest: gistSyncManifest, register: gistSyncRegister },
  { manifest: dockerManifest, register: dockerRegister },
  { manifest: proxmoxManifest, register: proxmoxRegister },
];
