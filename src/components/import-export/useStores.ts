// Aggregates all store reads/writes needed by the import-export system.
// The modal imports only this file — not individual stores.
// When adding a new data type, add one line here + a handler in registry.ts.

import { useConnectionStore } from "@/stores/connectionStore";
import { useIdentityStore } from "@/stores/identityStore";
import { useKeyStore } from "@/stores/keyStore";
import { useFolderStore } from "@/stores/folderStore";
import { useSnippetStore } from "@/stores/snippetStore";
import { useSnippetFolderStore } from "@/stores/snippetFolderStore";
import { usePortForwardingStore } from "@/stores/portForwardingStore";
import type { ImportStores, ReloadFns, StoreSlices } from "@/services/import-export/context";

export function useStoreSlices(): StoreSlices {
  const connections = useConnectionStore(s => s.connections);
  const identities = useIdentityStore(s => s.identities);
  const keys = useKeyStore(s => s.keys);
  const folders = useFolderStore(s => s.folders);
  const snippets = useSnippetStore(s => s.snippets);
  const snippetFolders = useSnippetFolderStore(s => s.folders);
  const pfRules = usePortForwardingStore(s => s.rules);
  return { connections, identities, keys, folders, snippets, snippetFolders, pfRules };
}

export function useImportStores(): ImportStores {
  const { saveFolder } = useFolderStore();
  const { saveFolder: saveSnippetFolder } = useSnippetFolderStore();
  const { saveKey } = useKeyStore();
  const { saveIdentity } = useIdentityStore();
  const { saveConnection, updateConnection } = useConnectionStore();
  const { createSnippet } = useSnippetStore();
  const { createRule: createPfRule } = usePortForwardingStore();
  return { saveFolder, saveSnippetFolder, saveKey, saveIdentity, saveConnection, updateConnection, createSnippet, createPfRule };
}

export function useReloadFns(): ReloadFns {
  const loadConnections = useConnectionStore(s => s.loadConnections);
  const loadIdentities = useIdentityStore(s => s.loadIdentities);
  const loadKeys = useKeyStore(s => s.loadKeys);
  const loadFolders = useFolderStore(s => s.loadFolders);
  const loadSnippets = useSnippetStore(s => s.loadSnippets);
  const loadSnippetFolders = useSnippetFolderStore(s => s.loadFolders);
  const loadPfRules = usePortForwardingStore(s => s.loadRules);
  return { loadConnections, loadIdentities, loadKeys, loadFolders, loadSnippets, loadSnippetFolders, loadPfRules };
}
