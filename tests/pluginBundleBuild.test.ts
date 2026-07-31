import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { init, parse } from "es-module-lexer";
import { HOST_SPECIFIERS } from "../src/plugins/hostSpecifiers";

const ROOT = path.resolve(__dirname, "..");
const PLUGINS_DIR = path.join(ROOT, "src/plugins");

// HOST_SPECIFIERS is the single source of truth (src/plugins/hostSpecifiers.ts, also
// used by hostModules.ts and vite.plugins.config.ts). A plugin bundle may bare-import
// these; anything else must have been inlined by the bundler — the webview has no
// module resolver for a bare npm specifier it doesn't recognize.

// Every plugin id with a manifest.json is migrated to the external-bundle pipeline
// and gets built by `pnpm build:plugins`. Deriving the list from disk (rather than
// hardcoding it, or importing scripts/build-plugins.mjs — which builds every plugin
// as an import-time side effect) keeps this test accurate as more plugins migrate.
function migratedPluginIds(): string[] {
  return readdirSync(PLUGINS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(path.join(PLUGINS_DIR, e.name, "manifest.json")))
    .map((e) => e.name);
}

// Plugin bundles run in a WebKitGTK webview: no Node globals, no second copy of
// react/react-dom, and no dev-mode JSX transform (the host only exposes the
// production react/jsx-runtime exports — jsx/jsxs/Fragment — not jsxDEV). Three real
// live-gate failures have come from this artifact, one layer behind the next, and
// none were visible to jsdom/Node unit tests (which have a `process`, run under
// NODE_ENV=test where ambient env doesn't matter to hand-written code, and don't care
// which JSX transform produced a tree). Only inspecting the actual built artifact
// catches this class of defect — so this test builds each migrated plugin for real
// and asserts on the output.
describe("plugin bundle build (webview compatibility)", () => {
  const ids = migratedPluginIds();

  // Build into a throwaway directory, never the real src-tauri/resources/plugins/<id>
  // output — that path is what `pnpm build` and the Tauri bundler ship. A build
  // spawned from inside a test run must not be able to overwrite release artifacts.
  let outRoot: string;
  beforeAll(() => {
    outRoot = mkdtempSync(path.join(tmpdir(), "voltius-plugin-build-"));
  });
  afterAll(() => {
    rmSync(outRoot, { recursive: true, force: true });
  });

  test("at least one migrated plugin pulls in a process.env-branching dependency", () => {
    // Sanity check that this test still exercises the failure mode it was written for.
    expect(ids).toContain("process-manager");
  });

  function buildAndRead(id: string): string {
    const outDir = path.join(outRoot, id);
    execFileSync(
      "pnpm",
      ["vite", "build", "--config", "vite.plugins.config.ts", "--outDir", outDir, "--emptyOutDir"],
      {
        cwd: ROOT,
        stdio: "pipe",
        // Deliberately does NOT force NODE_ENV=production here — the point of this
        // test is to prove the build pipeline itself pins production mode regardless
        // of the caller's ambient environment (vite.plugins.config.ts does this).
        // Leaving the test runner's own NODE_ENV (e.g. "test") in place is what
        // caught the dev-mode-JSX defect in the first place.
        env: { ...process.env, VOLTIUS_PLUGIN_ID: id },
      },
    );
    return readFileSync(path.join(outDir, "index.js"), "utf8");
  }

  test.each(ids)("%s bundle is webview-safe", async (id) => {
    const code = buildAndRead(id);

    // No Node globals — the webview has none.
    expect(code).not.toMatch(/\bprocess\.\w/);

    // Production JSX transform only — a dev-mode build imports jsxDEV from
    // react/jsx-dev-runtime, which the host does not expose.
    expect(code).not.toMatch(/\bjsxDEV\b/);
    expect(code).not.toContain("react/jsx-dev-runtime");

    // No inlined copy of react or react-dom — match the package's own nested
    // node_modules/<pkg>/ path segment specifically (rolldown's inlining marker),
    // not any substring: a legitimately-bundled dependency's pnpm store path can
    // contain "react-dom" in its own peer-dep hash (e.g.
    // `@tanstack+react-virtual@…_react-dom@19.2.7_react@…/node_modules/@tanstack/...`)
    // and would false-positive on a looser match.
    expect(code).not.toMatch(/node_modules[/\\]react[/\\]/);
    expect(code).not.toMatch(/node_modules[/\\]react-dom[/\\]/);

    // Every bare (non-relative) import specifier surviving in the artifact must be
    // one the host actually exposes — anything else should have been bundled in,
    // not left dangling for a browser module resolver that doesn't exist here.
    await init;
    const [imports] = parse(code);
    const bareSpecifiers = imports
      .map((imp) => imp.n)
      .filter((n): n is string => !!n && !n.startsWith(".") && !n.startsWith("/"));
    for (const specifier of bareSpecifiers) {
      expect(HOST_SPECIFIERS).toContain(specifier);
    }
  }, 30000);

  // Sparkline.tsx imports uplot/dist/uPlot.min.css, which Vite's lib build extracts
  // to a separate file rather than inlining. If that file isn't emitted under the
  // exact name the seeded-plugin loader (src/plugins/seeded.ts) reads, sparklines
  // ship unstyled with no build-time signal. Assert the artifact directly so a
  // rename of either side (this build config's cssFileName, or the loader's
  // filename) fails the suite instead of shipping silently.
  test("monitoring bundle emits its stylesheet as voltius.css", () => {
    expect(ids).toContain("monitoring");
    buildAndRead("monitoring");
    const cssPath = path.join(outRoot, "monitoring", "voltius.css");
    expect(existsSync(cssPath)).toBe(true);
    const css = readFileSync(cssPath, "utf8");
    expect(css.length).toBeGreaterThan(0);
    expect(css).toContain(".uplot");
  });
});
