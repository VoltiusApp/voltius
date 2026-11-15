import type { VaultObjectPorts } from "@/services/vaultObjectWrites";

type Bag = Record<string, unknown>;

/** Ports over a page test's hoisted state: lists read live from `h`, writes call its spies when it has them. */
export function objectPortsFrom(h: Bag): VaultObjectPorts {
  const list = <T>(key: string) => () => ((h[key] as T[] | undefined) ?? []);
  const call = (...keys: string[]) => (...args: unknown[]) => {
    const fn = keys.map((k) => h[k]).find((f): f is (...a: unknown[]) => unknown => typeof f === "function");
    return Promise.resolve(fn ? fn(...args) : undefined);
  };
  const snippetFolders = () => [
    ...((h.snippetFolders ?? h.folders ?? []) as never[]),
    ...Object.values((h.teamFolders ?? {}) as Record<string, never[]>).flat(),
  ];
  return {
    connections: list("connections"),
    keys: list("keys"),
    identities: list("identities"),
    snippets: list("snippets"),
    rules: list("rules"),
    folders: list("folders"),
    snippetFolders,
    saveConnection: call("saveConnection") as VaultObjectPorts["saveConnection"],
    updateConnection: call("updateConnection"),
    deleteConnection: call("deleteConnection"),
    loadConnections: call("loadConnections"),
    saveKey: call("saveKey") as VaultObjectPorts["saveKey"],
    updateKey: call("updateKey"),
    deleteKey: call("deleteKey"),
    loadKeys: call("loadKeys"),
    saveIdentity: call("saveIdentity") as VaultObjectPorts["saveIdentity"],
    updateIdentity: call("updateIdentity"),
    deleteIdentity: call("deleteIdentity"),
    loadIdentities: call("loadIdentities"),
    createSnippet: call("createSnippet") as VaultObjectPorts["createSnippet"],
    updateSnippet: call("updateSnippet"),
    deleteSnippet: call("deleteSnippet"),
    createRule: call("createRule") as VaultObjectPorts["createRule"],
    updateRule: call("updateRule"),
    deleteRule: call("deleteRule"),
    moveRuleFolder: call("moveRuleFolder"),
    moveObjectsToFolder: call("moveObjectsToFolder"),
    saveFolder: call("saveFolder") as VaultObjectPorts["saveFolder"],
    updateFolder: call("updateFolder"),
    deleteFolder: call("deleteFolder"),
    moveFolder: call("moveFolder"),
    saveSnippetFolder: call("saveSnippetFolder", "saveFolder") as VaultObjectPorts["saveSnippetFolder"],
    updateSnippetFolder: call("updateSnippetFolder", "updateFolder"),
    deleteSnippetFolder: call("deleteSnippetFolder", "deleteFolder"),
    moveSnippetFolder: call("moveSnippetFolder", "moveFolder"),
  };
}
