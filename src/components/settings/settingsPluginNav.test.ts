import { test, expect } from "vitest";
import type { SettingsPage } from "@/plugins/api";
import { pluginNavChildren, type NavPluginInfo } from "@/components/settings/settingsPluginNav";

const page = (id: string, label: string): SettingsPage =>
  ({ id, label, icon: "lucide:cog", component: () => null });

// The three real in-tree ids, verified against source.
const AI = page("plugin-ai-agent:settings", "AI Agent");
const SSH = page("plugin-ssh-config:settings", "SSH Config Sync");
const GIST = page("plugin-gist-sync:gist-sync-settings", "GitHub Gist Sync");

const PLUGINS: NavPluginInfo[] = [
  { id: "plugin-ai-agent", defaultEnabled: false },
  { id: "plugin-ssh-config", defaultEnabled: true },
  { id: "plugin-gist-sync", defaultEnabled: true },
];

const allEnabled = () => true;

test("hides an unattributable page (fail closed)", () => {
  const out = pluginNavChildren([page("orphan:settings", "Orphan")], PLUGINS, allEnabled);
  expect(out).toEqual([]);
});

test("hides a page whose plugin is disabled by an override", () => {
  // ssh-config registers its page even while disabled (index.ts:580 runs before the
  // isActive early-return), so only the enabled-filter can remove it.
  const isEnabled = (id: string, def: boolean) => (id === "plugin-ssh-config" ? false : def);
  const out = pluginNavChildren([SSH, GIST], PLUGINS, isEnabled);
  expect(out.map((c) => c.pageId)).toEqual(["plugin-gist-sync:gist-sync-settings"]);
});

test("honours defaultEnabled when no override exists", () => {
  // ai-agent ships defaultEnabled:false.
  const isEnabled = (_id: string, def: boolean) => def;
  const out = pluginNavChildren([AI, SSH], PLUGINS, isEnabled);
  expect(out.map((c) => c.pageId)).toEqual(["plugin-ssh-config:settings"]);
});

test("sorts children alphabetically by label", () => {
  const out = pluginNavChildren([SSH, AI, GIST], PLUGINS, allEnabled);
  expect(out.map((c) => c.label)).toEqual(["AI Agent", "GitHub Gist Sync", "SSH Config Sync"]);
});

test("carries label and icon through", () => {
  const out = pluginNavChildren([AI], PLUGINS, allEnabled);
  expect(out[0]).toEqual({ pageId: "plugin-ai-agent:settings", label: "AI Agent", icon: "lucide:cog" });
});

test("returns empty for no pages", () => {
  expect(pluginNavChildren([], PLUGINS, allEnabled)).toEqual([]);
});
