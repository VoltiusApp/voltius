import { describe, test, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");
const PLUGINS_DIR = path.join(ROOT, "src/plugins");

// Every plugin id with a manifest.json is migrated to the external-bundle pipeline
// and gets built by `pnpm build:plugins`. Deriving the list from disk (rather than
// hardcoding it, or importing scripts/build-plugins.mjs — which builds every plugin
// as an import-time side effect) keeps this test accurate as more plugins migrate.
function migratedPluginIds(): string[] {
  return readdirSync(PLUGINS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(path.join(PLUGINS_DIR, e.name, "manifest.json")))
    .map((e) => e.name);
}

// Regression coverage for a real webview failure: plugin bundles are loaded via
// `importPluginModule` in a WebKitGTK webview, which has no Node `process` global.
// A dependency (@tanstack/react-virtual, used by process-manager) branches on
// `process.env.NODE_ENV` for dev-only warnings; without a build-time `define`, that
// reference survives into the artifact verbatim and throws
// `ReferenceError: Can't find variable: process` at module-evaluation time — the
// plugin silently fails to load (seeded.ts swallows the throw into console.warn).
// jsdom/Node test environments have a real `process`, so this defect is invisible
// to every other test in the suite; only inspecting the actual built artifact catches it.
describe("plugin bundle build (webview compatibility)", () => {
  const ids = migratedPluginIds();
  test("at least one migrated plugin pulls in a process.env-branching dependency", () => {
    // Sanity check that this test still exercises the failure mode it was written for.
    expect(ids).toContain("process-manager");
  });

  test.each(ids)("%s bundle contains no bare `process.` reference", (id) => {
    execFileSync("pnpm", ["vite", "build", "--config", "vite.plugins.config.ts"], {
      cwd: ROOT,
      stdio: "pipe",
      env: { ...process.env, VOLTIUS_PLUGIN_ID: id },
    });
    const code = readFileSync(path.join(ROOT, `src-tauri/resources/plugins/${id}/index.js`), "utf8");
    expect(code).not.toMatch(/\bprocess\.\w/);
  }, 30000);
});
