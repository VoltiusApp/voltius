import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(async () => {}) }));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText: vi.fn(async () => {}) }));

const runSnippetSequence = vi.fn(async () => ({ targets: [], flattenErrors: [], openedSessionIds: [] }));
vi.mock("@/services/snippetSequence", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/snippetSequence")>()),
  runSnippetSequence: (...a: unknown[]) => runSnippetSequence(...(a as [])),
}));

import { loadPlugin, unloadPlugin } from "./runtime";
import { useSnippetStore } from "@/stores/snippetStore";
import { useSessionStore } from "@/stores/sessionStore";
import type { PluginManifest, PluginRegisterFn, PluginAPI } from "./api";
import type { Snippet, TerminalSession } from "@/types";

const snippet = {
  id: "s1", name: "restart", steps: [{ kind: "script", content: "echo hi" }],
  tags: [], favorite: false, only_for_connection_tags: [], only_for_distros: [],
  created_at: "", updated_at: "", vault_id: "personal", clocks: {},
} as unknown as Snippet;

function manifest(perms: string[]): PluginManifest {
  return { id: "t", name: "T", version: "1", permissions: perms };
}

let captured: PluginAPI;
const register: PluginRegisterFn = (api) => { captured = api; };

beforeEach(() => {
  vi.clearAllMocks();
  useSnippetStore.setState({ snippets: [snippet], teamSnippets: {} });
  vi.spyOn(useSnippetStore.getState(), "loadSnippets").mockResolvedValue();
  useSessionStore.setState({
    sessions: [{ id: "sess-1", connectionId: "c1", connectionName: "web-1", status: "connected", type: "ssh" } as TerminalSession],
  });
});
afterEach(() => { try { unloadPlugin("t"); } catch { /* noop */ } });

/** Running a snippet executes arbitrary user-authored commands on a host, so it
 *  costs the gated snippets:run on top of the read that names the snippet. */
describe("api.snippets.run permission gate", () => {
  const input = { snippetId: "s1", targets: [{ session_id: "sess-1" }] };
  /** The gate throws synchronously, ahead of the promise — as every other
   *  requirePerm'd verb does. Wrapped so the assertion reads the same either way. */
  const run = async (i: Parameters<PluginAPI["snippets"]["run"]>[0] = input) => captured.snippets.run(i);

  test("refuses a plugin that can read snippets but not run them", async () => {
    loadPlugin(manifest(["snippets:read", "snippets:write"]), register, true, false);
    await expect(run()).rejects.toThrow(/requires permission "snippets:run"/);
    expect(runSnippetSequence).not.toHaveBeenCalled();
  });

  test("refuses a plugin that holds snippets:run alone", async () => {
    loadPlugin(manifest(["snippets:run"]), register, true, false);
    await expect(run()).rejects.toThrow(/requires permission "snippets:read"/);
    expect(runSnippetSequence).not.toHaveBeenCalled();
  });

  test("refuses before the engine is reached, even on a dry run", async () => {
    loadPlugin(manifest([]), register, true, false);
    await expect(run({ ...input, dryRun: true })).rejects.toThrow(/snippets:read/);
  });

  test("runs on both grants", async () => {
    loadPlugin(manifest(["snippets:read", "snippets:run"]), register, true, false);
    await expect(run()).resolves.toMatchObject({ targets: [], opened_session_ids: [] });
    expect(runSnippetSequence).toHaveBeenCalled();
  });
});
