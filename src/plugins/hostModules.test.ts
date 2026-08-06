import { describe, test, expect, beforeEach, vi } from "vitest";
import { HOST_SPECIFIERS } from "./hostSpecifiers";

// The module memoizes its blob URLs in module scope, so each test needs a fresh
// copy — otherwise the idempotency guard from an earlier test suppresses injection
// here and the assertions measure the wrong thing.
async function freshModule() {
  vi.resetModules();
  return await import("./hostModules");
}

describe("hostModules", () => {
  beforeEach(() => {
    let n = 0;
    globalThis.URL.createObjectURL = vi.fn(
      () => `blob:host-${n++}`,
    ) as unknown as typeof URL.createObjectURL;
  });

  test("exposes a blob module for each public specifier", async () => {
    const { hostModuleUrls } = await freshModule();
    const urls = hostModuleUrls();
    expect(Object.keys(urls).sort()).toEqual([
      "@iconify/react",
      "@voltius/api",
      "@voltius/tools",
      "@voltius/ui",
      "react",
      "react-dom",
      "react/jsx-runtime",
      "zod",
    ]);
    for (const url of Object.values(urls)) expect(url.startsWith("blob:")).toBe(true);
  });

  // Guards against hostModuleUrls() and HOST_SPECIFIERS (the list vite.plugins.config.ts
  // externals and the bundle-build test both key off) drifting apart: add a specifier to
  // one without the other and externals + the bundle build both stay green while every
  // plugin importing it throws "disallowed specifier" at runtime.
  test("hostModuleUrls() keys exactly match HOST_SPECIFIERS", async () => {
    const { hostModuleUrls } = await freshModule();
    expect(Object.keys(hostModuleUrls()).sort()).toEqual([...HOST_SPECIFIERS].sort());
  });

  // The reason @iconify/react is a host specifier at all: the host registers
  // hand-written collections (src/utils/icons.ts) that don't exist on the public
  // Iconify API, so a bundle carrying its own inlined copy renders them as an
  // empty <span> — no error, no network fallback. Asserting through the global
  // registry is what a plugin's blob module actually reads.
  test("plugin blob module shares the host's Iconify icon storage", async () => {
    const { hostModuleUrls } = await freshModule();
    hostModuleUrls();
    const hostIconify = await import("@iconify/react");
    hostIconify.addCollection({
      prefix: "hostonly",
      icons: { probe: { body: "<path d='M0 0h24v24H0z'/>" } },
      width: 24,
      height: 24,
    });
    const registry = (globalThis as unknown as Record<string, Record<string, typeof hostIconify>>)
      .__voltiusHostModules;
    expect(registry["@iconify/react"].getIcon("hostonly:probe")).toBeTruthy();
  });

  // Sharing the host's Iconify storage (above) also means a plugin's addCollection
  // writes into it. Probed live 2026-07-31: re-registering devicon:proxmox-plain cut
  // the host entry to 35 bytes of path data — any plugin could repaint host chrome.
  async function freshWithHostPrefix(prefix: string) {
    vi.resetModules();
    const prefixes = await import("@/utils/hostIconPrefixes");
    prefixes.recordHostIconPrefix(prefix);
    const mod = await import("./hostModules");
    mod.hostModuleUrls();
    const registry = (globalThis as unknown as Record<string, Record<string, typeof import("@iconify/react")>>)
      .__voltiusHostModules;
    return registry["@iconify/react"];
  }

  test("a plugin cannot overwrite a host-owned icon collection", async () => {
    const pluginIconify = await freshWithHostPrefix("hostowned");
    const hostIconify = await import("@iconify/react");
    hostIconify.addCollection({
      prefix: "hostowned",
      icons: { logo: { body: "<path d='M0 0h24v24H0z'/>" } },
      width: 24, height: 24,
    });

    vi.spyOn(console, "warn").mockImplementation(() => {});
    const accepted = pluginIconify.addCollection({
      prefix: "hostowned",
      icons: { logo: { body: "<path d='M1 1'/>" } },
      width: 24, height: 24,
    });

    expect(accepted).toBe(false);
    expect(pluginIconify.getIcon("hostowned:logo")?.body).toBe("<path d='M0 0h24v24H0z'/>");
  });

  test("a plugin cannot overwrite a single host icon via addIcon", async () => {
    const pluginIconify = await freshWithHostPrefix("hostowned2");
    const hostIconify = await import("@iconify/react");
    hostIconify.addCollection({
      prefix: "hostowned2",
      icons: { logo: { body: "<path d='M0 0h24v24H0z'/>" } },
      width: 24, height: 24,
    });

    vi.spyOn(console, "warn").mockImplementation(() => {});
    const accepted = pluginIconify.addIcon("hostowned2:logo", { body: "<path d='M1 1'/>" });

    expect(accepted).toBe(false);
    expect(pluginIconify.getIcon("hostowned2:logo")?.body).toBe("<path d='M0 0h24v24H0z'/>");
  });

  test("a plugin can still register its own icons under its own prefix", async () => {
    const pluginIconify = await freshWithHostPrefix("hostowned3");
    const accepted = pluginIconify.addCollection({
      prefix: "acme-plugin",
      icons: { logo: { body: "<path d='M2 2'/>" } },
      width: 24, height: 24,
    });

    expect(accepted).toBe(true);
    expect(pluginIconify.getIcon("acme-plugin:logo")).toBeTruthy();
  });

  test("rewrites a bare react import to its blob URL", async () => {
    const { resolveHostSpecifiers, hostModuleUrls } = await freshModule();
    const out = await resolveHostSpecifiers(`import React from "react";`);
    expect(out).toBe(`import React from "${hostModuleUrls()["react"]}";`);
  });

  test("rewrites react/jsx-runtime without the react rule clobbering it", async () => {
    const { resolveHostSpecifiers, hostModuleUrls } = await freshModule();
    const out = await resolveHostSpecifiers(`import { jsx } from "react/jsx-runtime";`);
    expect(out).toContain(hostModuleUrls()["react/jsx-runtime"]);
    expect(out).not.toContain(`"${hostModuleUrls()["react"]}"`);
  });

  test("rewrites react-dom without the react rule clobbering it", async () => {
    const { resolveHostSpecifiers, hostModuleUrls } = await freshModule();
    const out = await resolveHostSpecifiers(`import { flushSync } from "react-dom";`);
    expect(out).toContain(hostModuleUrls()["react-dom"]);
    expect(out).not.toContain(`"${hostModuleUrls()["react"]}"`);
  });

  test("rewrites dynamic imports, keeping them quoted", async () => {
    const { resolveHostSpecifiers, hostModuleUrls } = await freshModule();
    const out = await resolveHostSpecifiers(`const m = await import("@voltius/ui");`);
    expect(out).toBe(`const m = await import("${hostModuleUrls()["@voltius/ui"]}");`);
  });

  test("rewrites export-from statements", async () => {
    const { resolveHostSpecifiers, hostModuleUrls } = await freshModule();
    const out = await resolveHostSpecifiers(`export * from "@voltius/api";`);
    expect(out).toContain(hostModuleUrls()["@voltius/api"]);
  });

  // The specifier is read from the source offsets, not es-module-lexer's `n`: it
  // decodes `n` with an indirect eval that a CSP without 'unsafe-eval' blocks,
  // yielding undefined for every import. Verified live 2026-08-01 — that skipped
  // every rewrite, so no plugin could resolve "react", and the allowlist below
  // silently stopped running.
  test("leaves import.meta alone rather than treating it as a specifier", async () => {
    const { resolveHostSpecifiers } = await freshModule();
    const src = `const u = import.meta.url; export const x = u;`;
    expect(await resolveHostSpecifiers(src)).toBe(src);
  });

  test("rejects an escaped host specifier instead of resolving it", async () => {
    const { resolveHostSpecifiers } = await freshModule();
    // Reading raw source means "react" is not the string "react"; fail closed.
    const src = `import React from "re\\u0061ct";`;
    await expect(resolveHostSpecifiers(src)).rejects.toThrow(/disallowed specifier/);
  });

  test("rejects a bare specifier the host does not provide", async () => {
    const { resolveHostSpecifiers } = await freshModule();
    const src = `import uPlot from "uplot";`;
    await expect(resolveHostSpecifiers(src)).rejects.toThrow(/disallowed specifier/);
  });

  test("rejects a remote URL specifier", async () => {
    const { resolveHostSpecifiers } = await freshModule();
    const src = `import x from "https://evil.example/x.js";`;
    await expect(resolveHostSpecifiers(src)).rejects.toThrow(/disallowed specifier/);
  });

  test("rejects a remote export-from specifier", async () => {
    const { resolveHostSpecifiers } = await freshModule();
    const src = `export * from "https://evil.example/x.js";`;
    await expect(resolveHostSpecifiers(src)).rejects.toThrow(/disallowed specifier/);
  });

  test("rejects a dynamic import() with a non-literal specifier", async () => {
    const { resolveHostSpecifiers } = await freshModule();
    const src = `const x = await import(atob("aHR0cHM6Ly9ldmls"));`;
    await expect(resolveHostSpecifiers(src)).rejects.toThrow(/non-literal specifier/);
  });

  test("still allows a relative specifier left by the bundler", async () => {
    const { resolveHostSpecifiers } = await freshModule();
    const src = `import x from "./chunk.js";`;
    expect(await resolveHostSpecifiers(src)).toBe(src);
  });

  test("still allows a parent-relative specifier left by the bundler", async () => {
    const { resolveHostSpecifiers } = await freshModule();
    const src = `import x from "../chunk.js";`;
    expect(await resolveHostSpecifiers(src)).toBe(src);
  });

  test("rejects a protocol-relative specifier", async () => {
    const { resolveHostSpecifiers } = await freshModule();
    const src = `import x from "//evil.com/x.js";`;
    await expect(resolveHostSpecifiers(src)).rejects.toThrow(/disallowed specifier/);
  });

  test("rejects a path-absolute specifier", async () => {
    const { resolveHostSpecifiers } = await freshModule();
    const src = `import x from "/x.js";`;
    await expect(resolveHostSpecifiers(src)).rejects.toThrow(/disallowed specifier/);
  });

  test("does not rewrite a string that merely contains a host specifier", async () => {
    const { resolveHostSpecifiers } = await freshModule();
    const src = `const label = "react"; console.log(label);`;
    expect(await resolveHostSpecifiers(src)).toBe(src);
  });

  test("does not rewrite import-like text inside a string literal", async () => {
    const { resolveHostSpecifiers } = await freshModule();
    const src = `console.warn('do not import from "react" directly; use the plugin API');`;
    expect(await resolveHostSpecifiers(src)).toBe(src);
  });

  test("rewrites the host specifier and leaves a relative specifier in a mixed bundle", async () => {
    const { resolveHostSpecifiers, hostModuleUrls } = await freshModule();
    const src = [
      `import React from "react";`,
      `import util from "./util.js";`,
      `export const x = 1;`,
    ].join("\n");
    const out = await resolveHostSpecifiers(src);
    expect(out).toContain(`"${hostModuleUrls()["react"]}"`);
    expect(out).toContain(`import util from "./util.js";`);
  });

  test("hostModuleSource exports reserved-word names", async () => {
    const { hostModuleSource } = await import("./hostModuleSource");
    const registry = ((globalThis as Record<string, unknown>).__voltiusHostModules ??= {}) as Record<
      string,
      unknown
    >;
    registry["test:reserved"] = { enum: 1, function: 2, void: 3, ok: 4 };

    const src = hostModuleSource("test:reserved", ["enum", "function", "void", "ok"]);
    const mod = await import(
      /* @vite-ignore */ "data:text/javascript," + encodeURIComponent(src)
    );

    expect(mod.enum).toBe(1);
    expect(mod.function).toBe(2);
    expect(mod.void).toBe(3);
    expect(mod.ok).toBe(4);
  });
});
