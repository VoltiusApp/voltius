import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useVaultStore } from "@/stores/vaultStore";
import { useTeamStore } from "@/stores/teamStore";
import { deleteTeam } from "@/services/teamService";
import { userFacingReason } from "@/services/errorReason";
import { reloadLocalVaultObjectStores } from "@/services/vaultTeamMigration";
import type { VaultAdminTarget } from "./vaultAdminTarget";

export interface VaultAdminCallbacks {
  onRenamed?: (name: string) => void;
  /** Fired after a successful delete or make-private, for hosts that must close. */
  onDone?: () => void;
}

async function vaultToast(message: string, severity: "info" | "error") {
  const { useNotificationStore } = await import("@/stores/notificationStore");
  useNotificationStore.getState().addToast({
    source: { kind: "plugin", id: "system", name: "Voltius" }, type: "toast",
    message, severity, duration: severity === "error" ? 6000 : 3000,
  });
}

export function useVaultAdminActions(target: VaultAdminTarget, cb?: VaultAdminCallbacks) {
  const { t } = useTranslation();
  const { renameVault, removeVault, setVaultTeamId } = useVaultStore();
  const { membersByTeam } = useTeamStore();
  const [busy, setBusy] = useState(false);
  // Modal.tsx's Enter handler stopPropagation()s but never preventDefault()s, so
  // pressing Enter on a focused Confirm button fires both the keydown handler
  // and the button's native click in the same tick — before React re-renders
  // `busy`. A ref closes that hole; state alone cannot.
  const makePrivateInFlight = useRef(false);

  const rename = (nextName: string) => {
    const trimmed = nextName.trim();
    if (!trimmed || !target.vaultId || trimmed === target.name) return;
    renameVault(target.vaultId, trimmed);
    cb?.onRenamed?.(trimmed);
  };

  const remove = () => {
    if (!target.vaultId) return;
    removeVault(target.vaultId);
    cb?.onDone?.();
  };

  const makePrivate = async () => {
    if (!target.vaultId || !target.teamId || makePrivateInFlight.current) return;
    makePrivateInFlight.current = true;
    setBusy(true);
    try {
      const { fetchTeamData } = await import("@/services/teamVaultSync");
      const { useConnectionStore } = await import("@/stores/connectionStore");
      const { useIdentityStore } = await import("@/stores/identityStore");
      const { useKeyStore } = await import("@/stores/keyStore");
      const { useFolderStore } = await import("@/stores/folderStore");
      const { useSnippetStore } = await import("@/stores/snippetStore");
      const { useSnippetFolderStore } = await import("@/stores/snippetFolderStore");
      const { usePortForwardingStore } = await import("@/stores/portForwardingStore");
      const connApi = await import("@/services/connections");
      const identApi = await import("@/services/identities");
      const keyApi = await import("@/services/keys");
      const folderApi = await import("@/services/folders");
      const snippetApi = await import("@/services/snippets");
      const pfApi = await import("@/services/portForwardingRules");
      const { clearTeamKeyCache } = await import("@/services/teamVaultSync");
      const { useTeamVaultStateStore } = await import("@/stores/teamVaultStateStore");

      const vaultId = target.vaultId!;
      const teamId = target.teamId!;

      await fetchTeamData(teamId);

      const now = new Date().toISOString();

      // Move entities from team memory to local disk with personal vault_id
      const conns = (useConnectionStore.getState().teamConnections[teamId] ?? [])
        .map((c) => ({ ...c, vault_id: vaultId, updated_at: now }));
      const identities = (useIdentityStore.getState().teamIdentities[teamId] ?? [])
        .map((i) => ({ ...i, vault_id: vaultId, updated_at: now }));
      const keys = (useKeyStore.getState().teamKeys[teamId] ?? [])
        .map((k) => ({ ...k, vault_id: vaultId, updated_at: now }));
      const folders = (useFolderStore.getState().teamFolders[teamId] ?? [])
        .map((f) => ({ ...f, vault_id: vaultId, updated_at: now }));
      const snippets = (useSnippetStore.getState().teamSnippets[teamId] ?? [])
        .map((s) => ({ ...s, vault_id: vaultId, updated_at: now }));
      const snippetFolders = (useSnippetFolderStore.getState().teamSnippetFolders[teamId] ?? [])
        .map((f) => ({ ...f, vault_id: vaultId, updated_at: now }));
      const portRules = (usePortForwardingStore.getState().teamRules[teamId] ?? [])
        .filter((r) => !r.deleted_at || r.updated_at > r.deleted_at)
        .map((r) => ({ ...r, vault_id: vaultId, updated_at: now }));

      const writes = await Promise.allSettled([
        ...conns.map((c) => connApi.saveConnection({ name: c.name, host: c.host, port: c.port, username: c.username, auth_type: c.auth_type, tags: c.tags, identity_id: c.identity_id, folder_id: c.folder_id, vault_id: vaultId })),
        ...identities.map((i) => identApi.saveIdentity({ name: i.name, username: i.username, key_id: i.key_id, tags: i.tags, folder_id: i.folder_id, vault_id: vaultId })),
        ...keys.map((k) => keyApi.saveKey({ name: k.name, key_type: k.key_type, tags: k.tags, folder_id: k.folder_id, vault_id: vaultId })),
        ...folders.map((f) => folderApi.saveFolder({ name: f.name, object_type: f.object_type, parent_folder_id: f.parent_folder_id, vault_id: vaultId })),
        ...snippets.map((s) => snippetApi.createSnippet({ name: s.name, steps: s.steps, description: s.description, tags: s.tags, folder_id: s.folder_id, favorite: s.favorite, only_for_connection_tags: s.only_for_connection_tags, only_for_distros: s.only_for_distros, vault_id: vaultId })),
        ...snippetFolders.map((f) => snippetApi.createSnippetFolder({ name: f.name, object_type: f.object_type, parent_folder_id: f.parent_folder_id, vault_id: vaultId })),
        ...portRules.map((r) => pfApi.createPfRule({ name: r.name, local_port: r.local_port, remote_port: r.remote_port, remote_host: r.remote_host, tunnel_type: r.tunnel_type, bind_host: r.bind_host, target_host: r.target_host, description: r.description, connection_ids: r.connection_ids, folder_id: r.folder_id, vault_id: vaultId })),
      ]);

      // Whatever failed to land on disk still exists only inside the team, so
      // deleting the team now would destroy the last copy of it.
      const rejected = writes.filter((w) => w.status === "rejected");
      if (rejected.length > 0) {
        console.error("Make private aborted: %d of %d writes failed", rejected.length, writes.length, rejected.map((r) => r.reason));
        await vaultToast(t("settings.vaults.general.makePrivate.copyFailedToast"), "error");
        return;
      }

      // The server delete is what actually revokes access, so it runs before the
      // local teardown: unlinking first would report a private vault to a user
      // whose members can all still open it.
      try {
        await deleteTeam(teamId);
      } catch (e) {
        await vaultToast(t("settings.vaults.general.makePrivate.removeMembersFailedToast", { reason: userFacingReason(e) }), "error");
        return;
      }

      useConnectionStore.getState().clearTeamConnections(teamId);
      useIdentityStore.getState().clearTeamIdentities(teamId);
      useKeyStore.getState().clearTeamKeys(teamId);
      useFolderStore.getState().clearTeamFolders(teamId);
      useSnippetStore.getState().clearTeamSnippets(teamId);
      useSnippetFolderStore.getState().clearTeamSnippetFolders(teamId);
      usePortForwardingStore.getState().clearTeamRules(teamId);

      setVaultTeamId(vaultId, null);
      clearTeamKeyCache();
      useTeamVaultStateStore.getState().setStatus(teamId, "idle");

      await reloadLocalVaultObjectStores();

      const memberN = membersByTeam[teamId]?.length ?? 0;
      await vaultToast(memberN > 1
        ? t("settings.vaults.general.madePrivateToast", { count: memberN - 1 })
        : t("settings.vaults.general.madePrivateToastEmpty"), "info");

      cb?.onDone?.();
    } catch (e) {
      console.error("Failed to make vault private:", e);
      await vaultToast(t("settings.vaults.general.makePrivate.failedToast", { reason: userFacingReason(e) }), "error");
    } finally {
      makePrivateInFlight.current = false;
      setBusy(false);
    }
  };

  return { busy, rename, remove, makePrivate };
}
