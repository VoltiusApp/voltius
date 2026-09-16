import { test, expect } from "vitest";
import { attributePage } from "./attributePage";

const PLUGIN_IDS = ["plugin-ai-agent", "plugin-ssh-config", "plugin-gist-sync"];

test("attributes each real in-tree page id to its plugin", () => {
  expect(attributePage("plugin-ai-agent:settings", PLUGIN_IDS)).toBe("plugin-ai-agent");
  expect(attributePage("plugin-ssh-config:settings", PLUGIN_IDS)).toBe("plugin-ssh-config");
  expect(attributePage("plugin-gist-sync:gist-sync-settings", PLUGIN_IDS)).toBe("plugin-gist-sync");
});

test("attributes a separator-less id stored verbatim by the runtime's startsWith branch", () => {
  // runtime.ts:509 leaves `page.id` alone when it already starts with the plugin id,
  // so this shape is reachable through the public registerSettingsPage API.
  expect(attributePage("plugin-x-extra", ["plugin-x-extra"])).toBe("plugin-x-extra");
});

test("longest prefix wins so a shorter plugin id cannot steal another's page", () => {
  expect(attributePage("plugin-x-extra:settings", ["plugin-x", "plugin-x-extra"])).toBe("plugin-x-extra");
});

test("returns null for a page belonging to no known plugin", () => {
  expect(attributePage("orphan:settings", ["plugin-x"])).toBeNull();
});
