import { describe, test, expect, vi } from "vitest";
import { orderPluginSections } from "./rightPanelOrder";
import { manifest as dockerManifest, register as registerDocker } from "@/plugins/docker";
import { register as registerMonitoring } from "@/plugins/monitoring";
import { register as registerProxmox } from "@/plugins/proxmox";
import { register as registerProcesses } from "@/plugins/process-manager";
import type { PluginAPI, RightPanelSection } from "@/plugins/api";

// monitoring's panel pulls in uplot, which reads a bare `matchMedia` at module
// scope. Hoisted so it lands before the plugin imports below are evaluated.
vi.hoisted(() => {
  if (typeof globalThis.matchMedia !== "function") {
    globalThis.matchMedia = (() => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
    })) as never;
  }
});

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));

describe("orderPluginSections", () => {
  test("is stable regardless of registration order", () => {
    const sections = [
      { id: "d", order: 20 },
      { id: "a", order: 40 },
      { id: "c", order: 10 },
      { id: "b", order: 30 },
    ];
    const forward = orderPluginSections(sections).map((s) => s.id);
    const reversed = orderPluginSections([...sections].reverse()).map((s) => s.id);
    expect(forward).toEqual(["c", "d", "b", "a"]);
    expect(reversed).toEqual(forward);
  });

  test("sections without an order sort last, tie-broken by id", () => {
    const out = orderPluginSections([
      { id: "zebra" },
      { id: "ordered", order: 10 },
      { id: "apple" },
    ]).map((s) => s.id);
    expect(out).toEqual(["ordered", "apple", "zebra"]);
  });

  test("ordering never depends on input order alone", () => {
    const unordered = [{ id: "b" }, { id: "a" }];
    expect(orderPluginSections(unordered).map((s) => s.id)).toEqual(["a", "b"]);
    expect(orderPluginSections([...unordered].reverse()).map((s) => s.id)).toEqual(["a", "b"]);
  });
});

// The user-visible half of the fix: pins the four first-party sections to the rail
// order they had before the plugins were externalised (the deleted bundled.ts array).
// A missing or duplicated `order` here reshuffles the rail for every existing user
// while every other test stays green.
describe("first-party rail order", () => {
  function sectionOf(register: (api: PluginAPI) => unknown, id: string): RightPanelSection {
    let captured: RightPanelSection | undefined;
    const api = {
      i18n: { register: () => {}, t: (k: string) => k },
      ui: {
        registerRightPanelSection: (s: RightPanelSection) => {
          captured = s;
          return () => {};
        },
        registerMobileScreen: () => () => {},
      },
      events: { on: () => () => {} },
      streams: { start: async () => "", stop: async () => {} },
      docker: {},
      proxmox: {},
      mcp: { registerTools: () => () => {} },
    } as unknown as PluginAPI;
    register(api);
    if (!captured) throw new Error(`${id} registered no right-panel section`);
    return captured;
  }

  test("Metrics, Docker, Proxmox, Processes — matching the pre-migration rail", () => {
    // Named so the manifest import is exercised too, keeping the plugin entry real.
    expect(dockerManifest.id).toBeTruthy();
    const sections = [
      sectionOf(registerProcesses, "processes"),
      sectionOf(registerProxmox, "proxmox"),
      sectionOf(registerMonitoring, "monitoring"),
      sectionOf(registerDocker, "docker"),
    ];
    // Asserted on id, not label: labels are locale-resolved now, ids are not.
    expect(orderPluginSections(sections).map((s) => s.id)).toEqual([
      "monitoring",
      "docker",
      "proxmox",
      "processes",
    ]);
    const orders = sections.map((s) => s.order);
    expect(orders.every((o) => typeof o === "number")).toBe(true);
    expect(new Set(orders).size).toBe(sections.length);
  });
});
