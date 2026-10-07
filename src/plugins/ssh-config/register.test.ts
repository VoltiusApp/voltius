import { describe, test, it, expect, vi, beforeEach } from "vitest";
import { register, manifest, setImportConsent } from "./index";
import { registerContributions, listContributions, clearContributions } from "@/mcp/contributions";
import type { BannerOptions, PluginAPI } from "@/plugins/api";
import { createI18nAPI } from "@/plugins/domains/i18n";
import { messages } from "./i18n";

// ─── Mock API builder ──────────────────────────────────────────────────────
// Minimal PluginAPI stub exercising only the surface ssh-config's register()
// and sync() touch. isActive is parameterised so we can assert the plugin stays
// inert while disabled.

const CONFIG = "Host box\n  HostName 10.0.0.5\n  User admin\n";

function makeApi(active: boolean, opts: { storage?: Record<string, unknown>; config?: string | null } = {}) {
  const watch = vi.fn(() => () => {});
  const registerSettingsPage = vi.fn(() => () => {});
  const connectionsList = vi.fn(async () => []);
  const store = new Map<string, unknown>(Object.entries(opts.storage ?? {}));
  const config = opts.config === undefined ? null : opts.config;
  const handlers = new Map<string, (data: unknown) => void>();
  const bannerDismiss = vi.fn();
  const banner = vi.fn((_message: string, _opts?: BannerOptions) => ({ dismiss: bannerDismiss, update: vi.fn() }));

  const api = {
    isActive: () => active,
    fs: {
      exists: vi.fn(async () => config !== null),
      readText: vi.fn(async () => config ?? ""),
      writeText: vi.fn(async () => {}),
      watch,
    },
    connections: { list: connectionsList, create: vi.fn(async () => ({ id: "c1" })), update: vi.fn() },
    keys: { list: vi.fn(async () => []) },
    identities: { list: vi.fn(async () => []) },
    storage: {
      get: vi.fn(async (k: string) => (store.has(k) ? store.get(k) : null)),
      set: vi.fn(async (k: string, v: unknown) => { store.set(k, v); }),
      delete: vi.fn(async () => {}),
    },
    events: {
      on: vi.fn((event: string, h: (data: unknown) => void) => { handlers.set(event, h); return () => handlers.delete(event); }),
      emit: vi.fn((event: string, data?: unknown) => handlers.get(event)?.(data)),
    },
    notifications: { toast: vi.fn(), banner },
    ui: { registerSettingsPage },
    lifecycle: { waitForLoginSync: vi.fn(() => Promise.resolve()) },
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    i18n: createI18nAPI(messages),
    mcp: { registerTools: (tools: Parameters<typeof registerContributions>[1]) => registerContributions(manifest.id, tools) },
  } as unknown as PluginAPI;

  const clickBanner = (index: number) => banner.mock.calls[0]![1]!.actions![index]!.onClick();

  return { api, watch, registerSettingsPage, connectionsList, store, banner, bannerDismiss, clickBanner };
}

const GRANTED = { import_consent: "granted" };

// Let every scheduled microtask/`.then` chain settle.
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("ssh-config register honors isActive()", () => {
  beforeEach(() => vi.clearAllMocks());

  test("disabled plugin does not watch or sync", async () => {
    const { api, watch, connectionsList, registerSettingsPage } = makeApi(false);
    const cleanup = register(api);
    await flush();
    await flush();

    expect(watch).not.toHaveBeenCalled();
    expect(connectionsList).not.toHaveBeenCalled();
    // Settings page must still be available while disabled.
    expect(registerSettingsPage).toHaveBeenCalledTimes(1);

    if (typeof cleanup === "function") cleanup();
  });

  test("enabled plugin starts the file watcher", async () => {
    const { api, watch } = makeApi(true, { storage: GRANTED });
    const cleanup = register(api);
    await flush();
    await flush();

    expect(watch).toHaveBeenCalled();

    if (typeof cleanup === "function") cleanup();
  });

  it("contributes a sync tool to MCP", async () => {
    clearContributions(manifest.id);
    const { api } = makeApi(true);
    const cleanup = register(api);
    await flush();
    await flush();

    // namespaceFor() strips the "plugin-" id prefix, so the verb is "ssh-config__sync".
    expect(listContributions().map((t) => t.name)).toContain("ssh-config__sync");

    if (typeof cleanup === "function") cleanup();
  });
});

describe("ssh-config cleanup before the deferred starts resolve", () => {
  beforeEach(() => vi.clearAllMocks());

  test("disabling before login sync settles never starts a watcher or a sync", async () => {
    const { api, watch } = makeApi(true, { storage: GRANTED, config: CONFIG });
    let settleLoginSync!: () => void;
    (api.lifecycle.waitForLoginSync as ReturnType<typeof vi.fn>).mockReturnValue(
      new Promise<void>((r) => { settleLoginSync = r; }),
    );

    const cleanup = register(api);
    if (typeof cleanup === "function") cleanup();
    settleLoginSync();
    await flush();
    await flush();

    expect(watch).not.toHaveBeenCalled();
    expect(api.fs.exists).not.toHaveBeenCalled();
  });
});

describe("ssh-config asks each account before importing (#557)", () => {
  beforeEach(() => vi.clearAllMocks());

  test("an account that never answered gets a prompt and nothing is imported", async () => {
    const { api, watch, connectionsList, banner } = makeApi(true, { config: CONFIG });
    const cleanup = register(api);
    await flush();
    await flush();

    expect(banner).toHaveBeenCalledTimes(1);
    expect(banner.mock.calls[0]![1]!.actions).toHaveLength(2);
    expect(watch).not.toHaveBeenCalled();
    expect(connectionsList).not.toHaveBeenCalled();

    if (typeof cleanup === "function") cleanup();
  });

  test("no prompt when ~/.ssh/config has nothing to import", async () => {
    for (const config of [null, "Host *\n  User root\n"]) {
      const { api, banner, watch } = makeApi(true, { config });
      const cleanup = register(api);
      await flush();
      await flush();

      expect(banner).not.toHaveBeenCalled();
      expect(watch).not.toHaveBeenCalled();
      if (typeof cleanup === "function") cleanup();
    }
  });

  test("accepting the prompt stores the answer, then imports and watches", async () => {
    const { api, watch, connectionsList, store, clickBanner } = makeApi(true, { config: CONFIG });
    const cleanup = register(api);
    await flush();
    await flush();

    clickBanner(0);
    await flush();
    await flush();

    expect(store.get("import_consent")).toBe("granted");
    expect(watch).toHaveBeenCalledTimes(1);
    expect(connectionsList).toHaveBeenCalled();

    if (typeof cleanup === "function") cleanup();
  });

  test("declining the prompt stores the answer and imports nothing", async () => {
    const { api, watch, connectionsList, store, clickBanner } = makeApi(true, { config: CONFIG });
    const cleanup = register(api);
    await flush();
    await flush();

    clickBanner(1);
    await flush();
    await flush();

    expect(store.get("import_consent")).toBe("declined");
    expect(watch).not.toHaveBeenCalled();
    expect(connectionsList).not.toHaveBeenCalled();

    if (typeof cleanup === "function") cleanup();
  });

  test("a declined account is never asked again and never imports", async () => {
    const { api, watch, connectionsList, banner } = makeApi(true, { config: CONFIG, storage: { import_consent: "declined" } });
    const cleanup = register(api);
    await flush();
    await flush();

    expect(banner).not.toHaveBeenCalled();
    expect(watch).not.toHaveBeenCalled();
    expect(connectionsList).not.toHaveBeenCalled();

    if (typeof cleanup === "function") cleanup();
  });

  test("an account already syncing hosts keeps syncing without a prompt", async () => {
    const { api, watch, connectionsList, banner, store } = makeApi(true, {
      config: CONFIG,
      storage: { alias_map: { box: "c1" } },
    });
    const cleanup = register(api);
    await flush();
    await flush();

    expect(banner).not.toHaveBeenCalled();
    expect(store.get("import_consent")).toBe("granted");
    expect(watch).toHaveBeenCalledTimes(1);
    expect(connectionsList).toHaveBeenCalled();

    if (typeof cleanup === "function") cleanup();
  });

  test("turning import off stops the watcher; a poll interval change does not restart it", async () => {
    const { api, watch } = makeApi(true, { config: CONFIG, storage: GRANTED });
    const stop = vi.fn();
    watch.mockReturnValue(stop);
    const cleanup = register(api);
    await flush();
    await flush();
    expect(watch).toHaveBeenCalledTimes(1);

    await setImportConsent(api, false);
    expect(stop).toHaveBeenCalledTimes(1);

    api.events.emit("ssh-config:restart-watcher", 10_000);
    expect(watch).toHaveBeenCalledTimes(1);

    if (typeof cleanup === "function") cleanup();
  });

  test("the MCP sync tool refuses for an account that has not allowed import", async () => {
    clearContributions(manifest.id);
    const { api, connectionsList } = makeApi(true, { config: CONFIG, storage: { import_consent: "declined" } });
    const cleanup = register(api);
    await flush();

    const tool = listContributions().find((t) => t.name === "ssh-config__sync")!;
    const result = await tool.execute({});

    expect(result).not.toBe("synced");
    expect(connectionsList).not.toHaveBeenCalled();

    if (typeof cleanup === "function") cleanup();
  });

  test("disabling the plugin withdraws a pending prompt", async () => {
    const { api, bannerDismiss } = makeApi(true, { config: CONFIG });
    const cleanup = register(api);
    await flush();
    await flush();

    if (typeof cleanup === "function") cleanup();
    expect(bannerDismiss).toHaveBeenCalledTimes(1);
  });
});
