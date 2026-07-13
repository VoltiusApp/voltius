import { describe, test, expect, vi, beforeEach } from "vitest";
import { register } from "./index";
import type { PluginAPI } from "@/plugins/api";

// Minimal PluginAPI stub. getPat()/getRegisteredGists() resolve to null, so
// isConfigured() is false and the poll IIFE early-returns — leaving the
// onBeforeQuit lifecycle wiring as the behaviour under test.

function makeApi(active: boolean) {
  const offBeforeQuit = vi.fn();
  const onBeforeQuit = vi.fn(() => offBeforeQuit);

  const api = {
    isActive: () => active,
    vault: { get: vi.fn(async () => null), set: vi.fn(), delete: vi.fn() },
    storage: { get: vi.fn(async () => null), set: vi.fn(async () => {}), delete: vi.fn(async () => {}) },
    ui: { registerSettingsPage: vi.fn(() => () => {}) },
    lifecycle: { onBeforeQuit, waitForLoginSync: vi.fn(() => Promise.resolve()) },
    notifications: { toast: vi.fn(), banner: vi.fn(), progress: vi.fn() },
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  } as unknown as PluginAPI;

  return { api, onBeforeQuit, offBeforeQuit };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("gist-sync register cleanup", () => {
  beforeEach(() => vi.clearAllMocks());

  test("cleanup unsubscribes the quit-time push handler", async () => {
    const { api, onBeforeQuit, offBeforeQuit } = makeApi(true);
    const cleanup = register(api);
    await flush();

    expect(onBeforeQuit).toHaveBeenCalledTimes(1);
    expect(offBeforeQuit).not.toHaveBeenCalled();

    if (typeof cleanup === "function") cleanup();
    expect(offBeforeQuit).toHaveBeenCalledTimes(1);
  });

  test("disabled plugin registers no quit handler", async () => {
    const { api, onBeforeQuit } = makeApi(false);
    const cleanup = register(api);
    await flush();

    expect(onBeforeQuit).not.toHaveBeenCalled();
    if (typeof cleanup === "function") cleanup();
  });
});
