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
