import { describe, test, expect, beforeEach, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));

import { getExcludedObjectIds } from "./sync";
import { useSyncPrefsStore } from "@/stores/syncPrefsStore";
import { useSnippetStore } from "@/stores/snippetStore";
import { useSnippetFolderStore } from "@/stores/snippetFolderStore";
import { useFolderStore } from "@/stores/folderStore";
import type { Snippet, Folder } from "@/types";

const snippet = (id: string): Snippet => ({
  id,
  name: id,
  steps: [],
  tags: [],
  favorite: false,
  only_for_connection_tags: [],
  only_for_distros: [],
  created_at: "2026-08-23T00:00:00.000Z",
  updated_at: "2026-08-23T00:00:00.000Z",
  vault_id: "personal",
  clocks: {},
});

const folder = (id: string, objectType: string): Folder => ({
  id,
  name: id,
  object_type: objectType,
  created_at: "2026-08-23T00:00:00.000Z",
  updated_at: "2026-08-23T00:00:00.000Z",
} as Folder);

describe("getExcludedObjectIds: snippets", () => {
  beforeEach(() => {
    useSyncPrefsStore.setState({ syncTypes: {}, excludedIds: [], settingSyncOverrides: { "appSettings.proxy": true } });
    useSnippetStore.setState({ snippets: [snippet("s1"), snippet("s2")] });
    useSnippetFolderStore.setState({ folders: [folder("sf1", "snippet_folder")] });
    useFolderStore.setState({ folders: [folder("f1", "connection_folder")] });
  });

  test("excludes nothing while every type is synced", () => {
    expect(getExcludedObjectIds()).toEqual([]);
  });

  test("switching the snippet type off excludes every snippet", () => {
    useSyncPrefsStore.getState().setSyncType("snippet", false);
    expect(getExcludedObjectIds().sort()).toEqual(["s1", "s2"]);
  });

  test("an individually excluded snippet is excluded while the type stays on", () => {
    useSyncPrefsStore.getState().toggleExcluded("s1");
    expect(getExcludedObjectIds()).toEqual(["s1"]);
  });

  // The snippet folder tree has no type of its own: FolderCard reads
  // isObjectSynced(id, "folder") for both trees, so the one toggle has to
  // reach snippet folders too.
  test("switching the folder type off excludes snippet folders as well as host folders", () => {
    useSyncPrefsStore.getState().setSyncType("folder", false);
    expect(getExcludedObjectIds().sort()).toEqual(["f1", "sf1"]);
  });
});

describe("getExcludedObjectIds: global proxy password", () => {
  beforeEach(() => {
    useSyncPrefsStore.setState({ syncTypes: {}, excludedIds: [], syncSettingDomains: {}, settingSyncOverrides: {} });
    useSnippetStore.setState({ snippets: [] });
    useSnippetFolderStore.setState({ folders: [] });
    useFolderStore.setState({ folders: [] });
  });

  test("withholds the global proxy secret while the proxy setting stays on this device (the default)", () => {
    expect(getExcludedObjectIds()).toEqual(["__global__"]);
  });

  test("lets the global proxy secret sync once the proxy setting is synced", () => {
    useSyncPrefsStore.getState().setSettingSync("appSettings.proxy", true);
    expect(getExcludedObjectIds()).toEqual([]);
  });

  test("withholds it again when the whole app-settings domain is off", () => {
    useSyncPrefsStore.getState().setSettingSync("appSettings.proxy", true);
    useSyncPrefsStore.getState().setSyncSettingDomain("appSettings", false);
    expect(getExcludedObjectIds()).toEqual(["__global__"]);
  });
});
