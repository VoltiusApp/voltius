import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

describe("getPlatformSync", () => {
  beforeEach(() => {
    vi.resetModules();
    invoke.mockReset();
  });

  it("is null before the platform resolves", async () => {
    invoke.mockReturnValue(new Promise(() => {}));
    const { getPlatform, getPlatformSync } = await import("./platform");
    getPlatform();
    expect(getPlatformSync()).toBeNull();
  });

  it("returns the resolved platform once known", async () => {
    invoke.mockResolvedValue("android");
    const { getPlatform, getPlatformSync } = await import("./platform");
    await getPlatform();
    expect(getPlatformSync()).toBe("android");
  });

  it("reports the fallback when the backend call fails", async () => {
    invoke.mockRejectedValue(new Error("no backend"));
    const { getPlatform, getPlatformSync } = await import("./platform");
    await getPlatform();
    expect(getPlatformSync()).toBe("unknown");
  });
});

describe("mobile platforms", () => {
  beforeEach(() => {
    vi.resetModules();
    invoke.mockReset();
  });

  it("treats Android and iOS as phones, and nothing else", async () => {
    const { isMobilePlatform } = await import("./platform");
    expect(isMobilePlatform("android")).toBe(true);
    expect(isMobilePlatform("ios")).toBe(true);
    for (const p of ["macos", "linux", "windows", "unknown", null]) expect(isMobilePlatform(p)).toBe(false);
  });

  it.each([
    ["android", true],
    ["ios", true],
    ["macos", false],
    ["windows", false],
  ])("isMobileShell on %s is %s once the platform resolves", async (os, mobile) => {
    invoke.mockResolvedValue(os);
    const { getPlatform, isMobileShell } = await import("./platform");
    expect(isMobileShell()).toBe(false);
    await getPlatform();
    expect(isMobileShell()).toBe(mobile);
  });
});
