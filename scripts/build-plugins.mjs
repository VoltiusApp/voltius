import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, existsSync } from "node:fs";

export const FIRST_PARTY_PLUGIN_IDS = [
  "ssh-config",
  "gist-sync",
  "monitoring",
  "docker",
  "process-manager",
  "proxmox",
];

const ids = process.argv.slice(2).length ? process.argv.slice(2) : FIRST_PARTY_PLUGIN_IDS;

for (const id of ids) {
  // Plugins migrate one task at a time; an id without a manifest.json is not migrated yet.
  // Skipping keeps `pnpm build` working mid-migration instead of failing on the first
  // un-migrated plugin. Once Task 13 lands, every id has one and nothing is skipped.
  if (!existsSync(`src/plugins/${id}/manifest.json`)) {
    console.warn(`[build-plugins] skipping "${id}": no manifest.json (not migrated yet)`);
    continue;
  }
  execFileSync("pnpm", ["vite", "build", "--config", "vite.plugins.config.ts"], {
    stdio: "inherit",
    env: { ...process.env, VOLTIUS_PLUGIN_ID: id },
  });
  const dir = `src-tauri/resources/plugins/${id}`;
  mkdirSync(dir, { recursive: true });
  copyFileSync(`src/plugins/${id}/manifest.json`, `${dir}/manifest.json`);
}
