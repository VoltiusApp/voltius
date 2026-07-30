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

  function buildAndRead(id: string): string {
    execFileSync("pnpm", ["vite", "build", "--config", "vite.plugins.config.ts"], {
      cwd: ROOT,
      stdio: "pipe",
      env: { ...process.env, VOLTIUS_PLUGIN_ID: id },
    });
    return readFileSync(path.join(ROOT, `src-tauri/resources/plugins/${id}/index.js`), "utf8");
  }

  test.each(ids)("%s bundle contains no bare `process.` reference", (id) => {
    expect(buildAndRead(id)).not.toMatch(/\bprocess\.\w/);
  }, 30000);

  // Regression coverage for a second real webview failure found one layer behind the
  // first: @tanstack/react-virtual imports flushSync from the "react-dom" peer dep.
  // react-dom was missing from vite.plugins.config.ts's `external` list, so rolldown
  // inlined a whole second copy of the renderer (its CJS build, verbatim) into
  // process-manager/index.js. That inlined copy's own `require("react")` then hit
  // rolldown's external-CJS shim and threw `Calling require for "react" in an
  // environment that doesn't expose the require function` at module-evaluation time —
  // same silent-failure shape as the process.env defect: swallowed by seeded.ts's
  // catch, invisible to jsdom/Node tests, only visible in the real webview.
  //
  // A single instance of react-dom (the host's) is also a correctness requirement, not
  // just a size one — a second renderer copy has separate internal state and a null
  // hook dispatcher for the host's own component tree.
  test.each(ids)("%s bundle does not inline a copy of react-dom", (id) => {
    const code = buildAndRead(id);
    // rolldown leaves a `//#region node_modules/.../node_modules/<pkg>/...` marker at
    // the start of every inlined (non-external) module — this is what an inlined
    // react-dom copy looks like when the `external` entry is missing or misspelled.
    // Match the package's own nested `node_modules/react-dom/` segment specifically —
    // a pnpm store path for an unrelated legitimately-bundled dependency (e.g.
    // `@tanstack+react-virtual@…_react-dom@19.2.7_react@…/node_modules/@tanstack/...`)
    // encodes react-dom's version in its peer-dep hash and would false-positive on a
    // looser match.
    expect(code).not.toMatch(/node_modules[/\\]react-dom[/\\]/);
    // If this plugin imports react-dom at all, it must survive as the bare external
    // specifier for resolveHostSpecifiers to rewrite, not get bundled away.
    if (/[\s"']react-dom['"\s]/.test(code) || code.includes("flushSync")) {
      expect(code).toMatch(/from\s*["']react-dom["']/);
    }
  }, 30000);
});
