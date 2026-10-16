import { pluginStorageClear, pluginStorageGetStrict } from "@/plugins/runtime";
import { useConnectionStore, connectionToFormData } from "@/stores/connectionStore";
import { useKeyStore, keyToFormData } from "@/stores/keyStore";
import { useIdentityStore, identityToFormData } from "@/stores/identityStore";
import { useMarketplaceStore } from "@/stores/marketplaceStore";
import { usePluginRegistryStore } from "@/stores/pluginRegistryStore";
import { personallyTagged, retagPersonal } from "@/stores/retagPersonal";
import * as connApi from "@/services/connections";
import * as keyApi from "@/services/keys";
import * as idApi from "@/services/identities";
import { isServerMode } from "@/services/account";
import { getDeviceId, scheduleSync } from "@/services/sync";
import { log } from "@/lib/logger";
import { loadSshConfigState, updateSshConfigState, type SshConfigState } from "./state";

const PLUGIN_ID = "plugin-ssh-config";
const TAG = "ssh-config";
const drop = (tags: string[]) => tags.filter((t) => t !== TAG);

export function oneToOne(map: Record<string, string>): Record<string, string> {
  const count = new Map<string, number>();
  for (const id of Object.values(map)) count.set(id, (count.get(id) ?? 0) + 1);
  return Object.fromEntries(Object.entries(map).filter(([, id]) => count.get(id) === 1));
}

async function readLegacy(): Promise<{ consent: string | null; aliasMap: Record<string, string> | null } | null> {
  try {
    return {
      consent: await pluginStorageGetStrict<string>(PLUGIN_ID, "import_consent"),
      aliasMap: await pluginStorageGetStrict<Record<string, string>>(PLUGIN_ID, "alias_map"),
    };
  } catch (e) {
    log.warn("ssh-config plugin storage unreadable; migrating from tags only and keeping the file", e);
    return null;
  }
}

export async function migrateFromPlugin(): Promise<void> {
  const device = await getDeviceId();
  if ((await loadSshConfigState()).migrated?.[device]) return;
  const legacy = await readLegacy();
  const { consent, aliasMap } = legacy ?? { consent: null, aliasMap: null };
  const [connections, keys, identities] = await Promise.all([connApi.listConnections(), keyApi.listKeys(), idApi.listIdentities()]);

  const tagged = personallyTagged([...connections, ...keys, ...identities], TAG).length > 0;
  const syncWasOn = consent !== "declined" && (consent === "granted" || Object.keys(aliasMap ?? {}).length > 0 || tagged);
  const offer: SshConfigState["offer"] = consent === "declined" ? "declined" : syncWasOn ? "accepted" : undefined;
  const legacyAliases = oneToOne(aliasMap ?? {});
  const hasLegacy = Object.keys(legacyAliases).length > 0;
  if (offer || hasLegacy) {
    await updateSshConfigState({ ...(offer && { offer }), ...(syncWasOn && { notice: "pending" }), ...(hasLegacy && { legacyAliases }) });
  }

  const retagged = [
    ...(await retagPersonal(connections, connectionToFormData, connApi.updateConnection, TAG, drop)),
    ...(await retagPersonal(keys, keyToFormData, keyApi.updateKey, TAG, drop)),
    ...(await retagPersonal(identities, identityToFormData, idApi.updateIdentity, TAG, drop)),
  ];
  if (retagged.length > 0) {
    await Promise.all([
      useConnectionStore.getState().loadConnections(),
      useKeyStore.getState().loadKeys(),
      useIdentityStore.getState().loadIdentities(),
    ]);
    if (await isServerMode()) scheduleSync();
  }

  if (useMarketplaceStore.getState().installedMeta.some((m) => m.id === PLUGIN_ID)) {
    await useMarketplaceStore.getState().uninstallPlugin(PLUGIN_ID);
  }
  const registry = usePluginRegistryStore.getState();
  if (registry.overrides[PLUGIN_ID] !== false) await registry.setEnabled(PLUGIN_ID, false);
  if (legacy) await pluginStorageClear(PLUGIN_ID);
  await updateSshConfigState({ migrated: { [device]: Date.now() } });
}
