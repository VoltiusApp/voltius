// @vitest-environment jsdom
import { describe, test, expect, beforeEach, vi } from "vitest";

const loadStore = async () => (await import("./uiStore")).useUIStore;

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
});

describe("uiStore right panel persistence", () => {
  test("an open right panel is open again after a restart", async () => {
    (await loadStore()).getState().toggleRightPanel("snippets");
    vi.resetModules();

    const { rightPanelOpen, rightPanelSection } = (await loadStore()).getState();
    expect(rightPanelOpen).toBe(true);
    expect(rightPanelSection).toBe("snippets");
  });

  test("a closed right panel stays closed after a restart", async () => {
    const store = await loadStore();
    store.getState().setRightPanelOpen(true);
    store.getState().setRightPanelOpen(false);
    vi.resetModules();

    expect((await loadStore()).getState().rightPanelOpen).toBe(false);
  });

  test("a first launch starts with the right panel closed", async () => {
    expect((await loadStore()).getState().rightPanelOpen).toBe(false);
  });
});
