import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Anchor every path to the repo root, not the caller's cwd. Run from anywhere but
// the repo root, a cwd-relative path silently resolves to nothing, every id "skips",
// and this script previously exited 0 having built zero plugins — after which
// `pnpm build` ships a release with no seeded plugins and no failure anywhere.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const FIRST_PARTY_PLUGIN_IDS = [
  "ssh-config",
  "gist-sync",
  "monitoring",
  "docker",
  "process-manager",
  "proxmox",
];

const ids = process.argv.slice(2).length ? process.argv.slice(2) : FIRST_PARTY_PLUGIN_IDS;

let built = 0;
for (const id of ids) {
  const manifestPath = path.join(ROOT, "src/plugins", id, "manifest.json");
  if (!existsSync(manifestPath)) {
    throw new Error(`[build-plugins] "${id}" has no manifest.json at ${manifestPath}`);
  }
  execFileSync("pnpm", ["vite", "build", "--config", "vite.plugins.config.ts"], {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, VOLTIUS_PLUGIN_ID: id },
  });
  const dir = path.join(ROOT, "src-tauri/resources/plugins", id);
  mkdirSync(dir, { recursive: true });
  copyFileSync(manifestPath, path.join(dir, "manifest.json"));
  built += 1;
}

console.log(`[build-plugins] built ${built} of ${ids.length}`);
if (built !== ids.length) {
  throw new Error(`[build-plugins] built ${built} of ${ids.length} — expected all of them`);
}
