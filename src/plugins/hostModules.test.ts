import { describe, test, expect, beforeEach, vi } from "vitest";

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

  test("exposes a blob module for each of the four public specifiers", async () => {
    const { hostModuleUrls } = await freshModule();
    const urls = hostModuleUrls();
    expect(Object.keys(urls).sort()).toEqual([
      "@voltius/api",
      "@voltius/ui",
      "react",
      "react/jsx-runtime",
    ]);
    for (const url of Object.values(urls)) expect(url.startsWith("blob:")).toBe(true);
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

  test("leaves third-party specifiers untouched", async () => {
    const { resolveHostSpecifiers } = await freshModule();
    const src = `import uPlot from "uplot";`;
    expect(await resolveHostSpecifiers(src)).toBe(src);
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

  test("rewrites only the host specifier in a bundle that mixes both", async () => {
    const { resolveHostSpecifiers, hostModuleUrls } = await freshModule();
    const src = [
      `import React from "react";`,
      `import uPlot from "uplot";`,
      `export const x = 1;`,
    ].join("\n");
    const out = await resolveHostSpecifiers(src);
    expect(out).toContain(`"${hostModuleUrls()["react"]}"`);
    expect(out).toContain(`import uPlot from "uplot";`);
  });
});
