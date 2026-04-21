/**
 * Plugins bundlés — importés statiquement au build.
 * Ajouter ici les imports de packages/plugin-* quand ils existeront.
 *
 * Format attendu :
 *   import { manifest, register } from "@voltius/plugin-ssh-config";
 *   export const BUNDLED_PLUGINS = [{ manifest, register }];
 */

import type { PluginManifest, PluginRegisterFn } from "./api";
import { manifest as sshConfigManifest, register as sshConfigRegister } from "./ssh-config";
import { manifest as importExportManifest, register as importExportRegister } from "./import-export";
import { manifest as gistSyncManifest, register as gistSyncRegister } from "./gist-sync";
import { manifest as monitoringManifest, register as monitoringRegister } from "./monitoring";
import { manifest as dockerManifest, register as dockerRegister } from "./docker";

export interface BundledPlugin {
  manifest: PluginManifest;
  register: PluginRegisterFn;
}

export const BUNDLED_PLUGINS: BundledPlugin[] = [
  { manifest: sshConfigManifest, register: sshConfigRegister },
  { manifest: importExportManifest, register: importExportRegister },
  { manifest: gistSyncManifest, register: gistSyncRegister },
  { manifest: monitoringManifest, register: monitoringRegister },
  { manifest: dockerManifest, register: dockerRegister },
];
