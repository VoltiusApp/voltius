// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const platform = vi.hoisted(() => ({ value: "linux" }));
vi.mock("@/utils/platform", () => ({ getPlatform: () => Promise.resolve(platform.value) }));

import { confirmLanSyncIntro, ensureLanSyncIntro, useLanSyncIntroStore } from "./lanSyncIntro";
import { useLanSyncStore } from "@/stores/lanSyncStore";

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  useLanSyncStore.setState({ introShown: false });
  useLanSyncIntroStore.setState({ open: false });
});

describe("ensureLanSyncIntro", () => {
  it("resolves without a modal on linux", async () => {
    platform.value = "linux";
    await ensureLanSyncIntro();
    expect(useLanSyncIntroStore.getState().open).toBe(false);
  });

  it("opens on macos and windows, resolves on continue, sets the flag", async () => {
    for (const p of ["macos", "windows"]) {
      useLanSyncStore.setState({ introShown: false });
      platform.value = p;
      let done = false;
      const run = ensureLanSyncIntro().then(() => { done = true; });
      await flush();
      expect(useLanSyncIntroStore.getState().open).toBe(true);
      expect(done).toBe(false);
      confirmLanSyncIntro();
      await run;
      expect(useLanSyncIntroStore.getState().open).toBe(false);
      expect(useLanSyncStore.getState().introShown).toBe(true);
    }
  });

  it("does not open when already shown", async () => {
    platform.value = "macos";
    useLanSyncStore.setState({ introShown: true });
    await ensureLanSyncIntro();
    expect(useLanSyncIntroStore.getState().open).toBe(false);
  });

  it("resolves concurrent callers on one continue", async () => {
    platform.value = "macos";
    const a = ensureLanSyncIntro();
    const b = ensureLanSyncIntro();
    await flush();
    confirmLanSyncIntro();
    await Promise.all([a, b]);
    expect(useLanSyncIntroStore.getState().open).toBe(false);
  });
});
