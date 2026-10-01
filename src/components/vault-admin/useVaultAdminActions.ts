import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useVaultStore } from "@/stores/vaultStore";
import { useTeamStore } from "@/stores/teamStore";
import { deleteTeam, renameTeam } from "@/services/teamService";
import { markSelfDeparture } from "@/services/teamOffboarding";
import { userFacingReason } from "@/services/errorReason";
import { logFailure } from "@/lib/logger";
import { reloadLocalVaultObjectStores } from "@/services/vaultTeamMigration";
import { deleteVaultWithContents } from "@/services/vaultObjectStores";
import { makePrivateMemberMessage, type VaultAdminTarget } from "./vaultAdminTarget";

export interface VaultAdminCallbacks {
  onRenamed?: (name: string) => void;
  /** Fired after a successful delete or make-private, for hosts that must close. */
  onDone?: () => void;
}

export function deselectVault(id: string) {
  const { selectedVaultIds, toggleVault } = useVaultStore.getState();
  if (selectedVaultIds.includes(id)) toggleVault(id);
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
  const { renameVault, setVaultTeamId } = useVaultStore();
  const [busy, setBusy] = useState(false);
  // Modal.tsx's Enter handler stopPropagation()s but never preventDefault()s, so
  // pressing Enter on a focused Confirm button fires both the keydown handler
  // and the button's native click in the same tick — before React re-renders
  // `busy`. A ref closes that hole; state alone cannot.
  const inFlight = useRef(false);

  /**
   * Runs one destructive verb at a time. Both are irreversible and both sit
   * behind a confirm button, so they share the ref rather than holding one
   * each: it is set before the first `await`, which is what makes a duplicate
   * call a no-op instead of a second full pass.
   */
  /** Every failure here reports the same way: the reason, never the raw error. */
  const failToast = (key: string, e: unknown) =>
    vaultToast(t(key, { reason: userFacingReason(e) }), "error");

  const exclusive = async (run: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      await run();
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const rename = (nextName: string) => {
    const trimmed = nextName.trim();
    if (!trimmed || trimmed === target.name) return;
    const teamId = target.teamId;
    if (teamId) {
      void exclusive(async () => {
        try {
          await renameTeam(teamId, trimmed);
          await useTeamStore.getState().loadTeams();
          cb?.onRenamed?.(trimmed);
        } catch (e) {
          await failToast("settings.vaults.general.renameFailedToast", e);
        }
      });
      return;
    }
    if (!target.vaultId) return;
    renameVault(target.vaultId, trimmed);
    cb?.onRenamed?.(trimmed);
  };

  /**
   * Deletes the vault *and* its contents, which is what the confirm dialog has
   * always promised. Until now only the record went, leaving every object alive
   * under a vault_id nothing resolves — the rail's "?" entry.
   *
   * A failed sweep leaves the record in place on purpose: whatever survived
   * stays filed under a named vault instead of becoming an orphan.
   */
  const remove = () => exclusive(async () => {
    const { vaultId, teamId } = target;
    if (teamId) {
      try {
        // "leave", not "self-deleted": the echo must still wipe this device's team copies, just without a removal notice.
        markSelfDeparture(teamId, "leave");
        await deleteTeam(teamId);
      } catch (e) {
        await failToast("settings.vaults.general.deleteVault.teamFailedToast", e);
        return;
      }
      deselectVault(teamId);
    }
    if (vaultId) {
      try {
        await deleteVaultWithContents(vaultId);
      } catch (e) {
        console.error("Failed to delete vault:", e);
        await failToast("settings.vaults.general.deleteVault.failedToast", e);
        return;
      }
    }
    cb?.onDone?.();
  });

  const makePrivate = async () => {
    if (!target.vaultId || !target.teamId) return;
    await exclusive(async () => {
      try {
        const { fetchTeamData } = await import("@/services/teamVaultSync");
        const { useConnectionStore, connectionToFormData } = await import("@/stores/connectionStore");
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
        const { readSecretAt, writeSecretAt } = await import("@/services/secretRouting");
        const { secretKeysOfObjects } = await import("@/services/teamVaultSecretKeys");
        const { teamSecretCache } = await import("@/services/teamSecretCache");
        const { listTeamObjects } = await import("@/services/teamObjects");

        const vaultId = target.vaultId!;
        const teamId = target.teamId!;

        await fetchTeamData(teamId);
        const copyFailed = () => vaultToast(t("settings.vaults.general.makePrivate.copyFailedToast"), "error");
        const loadState = useTeamVaultStateStore.getState();
        const loaded = loadState.statusByTeamId[teamId] === "loaded" && !loadState.credentialsUnavailableByTeamId[teamId];
        const listedIds = loaded
          ? await listTeamObjects(teamId).then(
            (records) => records.filter((r) => !r.deleted_at).map((r) => r.object_id),
            (e) => {
              logFailure("makePrivate: list team objects")(e);
              return null;
            },
          )
          : null;

        // Own ids: secret keys and cross-references name them, and adopt
        // overwrites, so a retry repairs a partial copy.
        const conns = useConnectionStore.getState().teamConnections[teamId] ?? [];
        const identities = useIdentityStore.getState().teamIdentities[teamId] ?? [];
        const keys = useKeyStore.getState().teamKeys[teamId] ?? [];
        const folders = useFolderStore.getState().teamFolders[teamId] ?? [];
        const snippets = useSnippetStore.getState().teamSnippets[teamId] ?? [];
        const snippetFolders = useSnippetFolderStore.getState().teamSnippetFolders[teamId] ?? [];
        const teamRules = usePortForwardingStore.getState().teamRules[teamId] ?? [];
        const portRules = teamRules.filter((r) => !r.deleted_at || r.updated_at > r.deleted_at);

        const loadedIds = new Set([...conns, ...identities, ...keys, ...folders, ...snippets, ...snippetFolders, ...teamRules].map((o) => o.id));
        // A failed or legacy-blob load can be empty or stale: every object the server lists must be in the loaded stores.
        if (!listedIds || listedIds.some((id) => !loadedIds.has(id))) {
          await copyFailed();
          return;
        }

        const writes = await Promise.allSettled([
          ...conns.map((c) => connApi.adoptConnection(c.id, { ...connectionToFormData(c), vault_id: vaultId })),
          ...identities.map((i) => identApi.adoptIdentity(i.id, { name: i.name, username: i.username, key_id: i.key_id, tags: i.tags, folder_id: i.folder_id, pinned: i.pinned, vault_id: vaultId })),
          ...keys.map((k) => keyApi.adoptKey(k.id, { name: k.name, key_type: k.key_type, tags: k.tags, folder_id: k.folder_id, pinned: k.pinned, vault_id: vaultId })),
          ...folders.map((f) => folderApi.adoptFolder(f.id, { name: f.name, object_type: f.object_type, parent_folder_id: f.parent_folder_id, color: f.color, icon: f.icon, pinned: f.pinned, vault_id: vaultId })),
          ...snippets.map((s) => snippetApi.adoptSnippet(s.id, { name: s.name, steps: s.steps, description: s.description, tags: s.tags, folder_id: s.folder_id, favorite: s.favorite, only_for_connection_tags: s.only_for_connection_tags, only_for_distros: s.only_for_distros, vault_id: vaultId })),
          ...snippetFolders.map((f) => snippetApi.adoptSnippetFolder(f.id, { name: f.name, object_type: f.object_type, parent_folder_id: f.parent_folder_id, color: f.color, icon: f.icon, pinned: f.pinned, vault_id: vaultId })),
          ...portRules.map((r) => pfApi.adoptPfRule(r.id, { name: r.name, local_port: r.local_port, remote_port: r.remote_port, remote_host: r.remote_host, tunnel_type: r.tunnel_type, bind_host: r.bind_host, target_host: r.target_host, description: r.description, connection_ids: r.connection_ids, folder_id: r.folder_id, vault_id: vaultId })),
        ]);

        // Whatever failed to land on disk still exists only inside the team, so
        // deleting the team now would destroy the last copy of it.
        const rejected = writes.filter((w) => w.status === "rejected");
        if (rejected.length > 0) {
          console.error("Make private aborted: %d of %d writes failed", rejected.length, writes.length, rejected.map((r) => r.reason));
          await copyFailed();
          return;
        }

        // Team secrets live only in memory and on the server, and the server copy goes with the team.
        const withSecrets = { connection: conns, key: keys, identity: identities };
        const secretKeys = secretKeysOfObjects((kind) => withSecrets[kind].map((o) => o.id));
        const copies = await Promise.allSettled(secretKeys.map(async (k) => {
          const value = await readSecretAt(teamId, k);
          if (value) await writeSecretAt(null, k, value);
        }));
        const failedCopies = copies.filter((c) => c.status === "rejected");
        if (failedCopies.length > 0) {
          console.error("Make private aborted: %d secrets not copied", failedCopies.length, failedCopies.map((r) => r.reason));
          await copyFailed();
          return;
        }

        // The server delete is what actually revokes access, so it runs before the
        // local teardown: unlinking first would report a private vault to a user
        // whose members can all still open it.
        try {
          // Marked before the request, not after: the server echoes the delete
          // back as a membership_changed, and an unmarked one reads as this user
          // being kicked — the wrong notice, and an offboarding wipe aimed at the
          // copies just adopted under those same ids (#249).
          markSelfDeparture(teamId, "self-deleted");
          await deleteTeam(teamId);
        } catch (e) {
          await failToast("settings.vaults.general.makePrivate.removeMembersFailedToast", e);
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
        teamSecretCache.clearTeam(teamId);
        clearTeamKeyCache();
        useTeamVaultStateStore.getState().setStatus(teamId, "idle");

        await reloadLocalVaultObjectStores();

        // Read at toast time, not at render time: the roster this reports on is
        // the one `fetchTeamData` just refreshed, and the confirm prompt the user
        // answered was rendered from that same refreshed store.
        const memberN = useTeamStore.getState().membersByTeam[teamId]?.length ?? 0;

        // Own the whole teardown: the offboarding path used to drop these
        // slices, and it no longer runs for a team its owner deleted (#249).
        // After the toast has read the roster, never before it.
        useTeamStore.getState().removeTeam(teamId);

        await vaultToast(makePrivateMemberMessage(memberN, t, {
          others: "settings.vaults.general.madePrivateToast",
          alone: "settings.vaults.general.madePrivateToastEmpty",
        }), "info");

        cb?.onDone?.();
      } catch (e) {
        console.error("Failed to make vault private:", e);
        await failToast("settings.vaults.general.makePrivate.failedToast", e);
      }
    });
  };

  return { busy, rename, remove, makePrivate };
}
