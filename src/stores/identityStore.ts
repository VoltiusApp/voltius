import { create } from "zustand";
import type { Identity, IdentityFormData } from "@/types";
import * as api from "@/services/identities";
import { scheduleSync } from "@/services/sync";
import { isServerMode } from "@/services/account";
import { useSyncPrefsStore } from "@/stores/syncPrefsStore";
import { useHistoryStore } from "@/stores/historyStore";
import { pushCreateHistory, pushDeleteHistory } from "@/stores/recreateHistory";
import { isTeamVaultId, findTeamEntry, setTeamMapEntry, clearTeamMapEntry, upsertInTeamMap, removeFromTeamMap, applyVaultTransition, saveStampedTeamObject } from "@/stores/teamVaultMap";
import { reportAuditMutation } from "@/services/auditMutations";
import { removeTeamVaultObject, saveTeamVaultObject } from "@/services/teamObjectPersistence";
import { classifyVaultTransition, migrateVaultObject } from "@/services/teamVaultMigration";
import { withPin } from "@/stores/withPin";
import { useTeamObjectPrefsStore } from "@/stores/teamObjectPrefsStore";

/** Rebuilds a full IdentityFormData from a stored identity: `identity_update`
 *  replaces rather than merges, so a partial payload must spread this. */
function identityToFormData(i: Identity): IdentityFormData {
  return {
    name: i.name, username: i.username, key_id: i.key_id,
    tags: i.tags,
    folder_id: i.folder_id, vault_id: i.vault_id,
  };
}

interface IdentityStore {
  identities: Identity[];
  teamIdentities: Record<string, Identity[]>;
  loadIdentities: () => Promise<void>;
  setTeamIdentities: (teamId: string, items: Identity[]) => void;
  clearTeamIdentities: (teamId?: string) => void;
  saveIdentity: (data: IdentityFormData) => Promise<Identity>;
  updateIdentity: (id: string, data: IdentityFormData) => Promise<void>;
  deleteIdentity: (id: string) => Promise<void>;
  pinIdentity: (id: string, pinned: boolean | null) => Promise<void>;
  pinIdentityForTeam: (id: string, pinned: boolean) => Promise<void>;
}

export const useIdentityStore = create<IdentityStore>((set, get) => ({
  identities: [],
  teamIdentities: {},

  loadIdentities: async () => {
    const identities = await api.listIdentities();
    set({ identities });
  },

  setTeamIdentities: (teamId, items) =>
    set((s) => ({ teamIdentities: setTeamMapEntry(s.teamIdentities, teamId, items) })),

  clearTeamIdentities: (teamId) =>
    set((s) => ({ teamIdentities: clearTeamMapEntry(s.teamIdentities, teamId) })),

  saveIdentity: async (data) => {
    if (isTeamVaultId(data.vault_id)) {
      const now = new Date().toISOString();
      const identity: Identity = {
        id: crypto.randomUUID(),
        name: data.name,
        username: data.username,
        key_id: data.key_id,
        tags: data.tags,
        folder_id: data.folder_id,
        vault_id: data.vault_id,
        pinned: data.pinned,
        created_at: now,
        updated_at: now,
        clocks: { created_at: now, updated_at: now },
      };
      const vaultId = data.vault_id!;
      await saveTeamVaultObject(vaultId, "identity", identity);
      set((s) => ({ teamIdentities: upsertInTeamMap(s.teamIdentities, vaultId, identity) }));
      reportAuditMutation("identity", "created", { id: identity.id, name: identity.name ?? identity.username, vault_id: identity.vault_id });
      pushCreateHistory({
        label: `Created identity "${identity.name ?? identity.username}"`,
        id: identity.id,
        data,
        create: (d) => useIdentityStore.getState().saveIdentity(d),
        remove: (iid) => useIdentityStore.getState().deleteIdentity(iid),
      });
      return identity;
    }

    const identity = await api.saveIdentity(data);
    const identities = await api.listIdentities();
    set({ identities });
    const prefs = useSyncPrefsStore.getState();
    isServerMode().then((s) => { if (s && prefs.isTypeSynced("identity")) scheduleSync(); });
    reportAuditMutation("identity", "created", { id: identity.id, name: identity.name ?? identity.username, vault_id: identity.vault_id });
    pushCreateHistory({
      label: `Created identity "${identity.name ?? identity.username}"`,
      id: identity.id,
      data,
      create: (d) => useIdentityStore.getState().saveIdentity(d),
      remove: (iid) => useIdentityStore.getState().deleteIdentity(iid),
    });
    return identity;
  },

  updateIdentity: async (id, data) => {
    const teamEntry = findTeamEntry(get().teamIdentities, id);
    if (teamEntry) {
      const { teamId, item: prev } = teamEntry;
      const payload = withPin(data, prev);
      const now = new Date().toISOString();
      const updated: Identity = {
        ...prev,
        name: data.name,
        username: data.username,
        key_id: data.key_id,
        tags: data.tags,
        folder_id: data.folder_id,
        vault_id: data.vault_id ?? prev.vault_id,
        pinned: payload.pinned,
        updated_at: now,
        clocks: { ...prev.clocks, updated_at: now },
      };
      const migrated = await migrateVaultObject({
        previousVaultId: teamId,
        nextVaultId: updated.vault_id,
        isTeamVaultId,
        item: updated,
        updateLocal: () => api.updateIdentity(id, payload).then(() => updated),
        adoptLocal: () => api.adoptIdentity(id, payload).then(() => updated),
        saveTeam: (tid, item) => saveTeamVaultObject(tid, "identity", item),
        removeTeam: removeTeamVaultObject,
      });
      const transition = classifyVaultTransition(teamId, migrated.vault_id, isTeamVaultId);
      const localIdentities = transition.kind === "team-to-local" ? await api.listIdentities() : undefined;
      set((s) => {
        const next = applyVaultTransition(s.teamIdentities, transition, id, migrated, teamId);
        return localIdentities ? { identities: localIdentities, teamIdentities: next } : { teamIdentities: next };
      });
      reportAuditMutation("identity", "updated", { id: migrated.id, name: migrated.name ?? migrated.username, vault_id: migrated.vault_id });
      const prevData = identityToFormData(prev);
      useHistoryStore.getState().push({
        label: `Updated identity "${prev.name ?? prev.username}"`,
        undo: async () => { await useIdentityStore.getState().updateIdentity(id, prevData); },
        redo: async () => { await useIdentityStore.getState().updateIdentity(id, data); },
      });
      return;
    }

    const prev = get().identities.find((i) => i.id === id);
    let updated: Identity | undefined;
    if (prev) {
      const nextVaultId = data.vault_id ?? prev.vault_id;
      const payload = withPin(data, prev);
      updated = await migrateVaultObject<Identity>({
        previousVaultId: prev.vault_id,
        nextVaultId,
        isTeamVaultId,
        item: { ...prev, ...payload, vault_id: nextVaultId } as Identity,
        updateLocal: () => api.updateIdentity(id, payload).then(() => ({ ...prev, ...payload, vault_id: nextVaultId } as Identity)),
        adoptLocal: () => api.adoptIdentity(id, payload).then(() => ({ ...prev, ...payload, vault_id: nextVaultId } as Identity)),
        saveTeam: (teamId, item) => saveTeamVaultObject(teamId, "identity", item),
        removeTeam: removeTeamVaultObject,
      });
    } else {
      await api.updateIdentity(id, data);
    }
    const identities = await api.listIdentities();
    set((s) => ({
      identities,
      teamIdentities: prev && updated
        ? applyVaultTransition(s.teamIdentities, classifyVaultTransition(prev.vault_id, updated.vault_id, isTeamVaultId), id, updated)
        : s.teamIdentities,
    }));
    const prefs = useSyncPrefsStore.getState();
    isServerMode().then((s) => { if (s && prefs.isObjectSynced(id, "identity")) scheduleSync(); });
    if (prev) reportAuditMutation("identity", "updated", { id, name: data.name ?? prev.name ?? prev.username, vault_id: data.vault_id ?? prev.vault_id });
    if (prev) {
      const prevData = identityToFormData(prev);
      useHistoryStore.getState().push({
        label: `Updated identity "${prev.name ?? prev.username}"`,
        undo: async () => { await useIdentityStore.getState().updateIdentity(id, prevData); },
        redo: async () => { await useIdentityStore.getState().updateIdentity(id, data); },
      });
    }
  },

  pinIdentity: async (id, pinned) => {
    const teamEntry = findTeamEntry(get().teamIdentities, id);
    if (teamEntry) {
      await useTeamObjectPrefsStore.getState().setPinned(teamEntry.teamId, id, pinned);
      return;
    }

    const identity = get().identities.find((i) => i.id === id);
    if (!identity) return;
    const nextPinned = pinned ?? false;
    await api.updateIdentity(id, { ...identityToFormData(identity), pinned: nextPinned });
    const identities = await api.listIdentities();
    set({ identities });
    const prefs = useSyncPrefsStore.getState();
    isServerMode().then((s) => { if (s && prefs.isObjectSynced(id, "identity")) scheduleSync(); });
  },

  pinIdentityForTeam: async (id, pinned) => {
    const teamEntry = findTeamEntry(get().teamIdentities, id);
    if (!teamEntry) return;
    const { teamId } = teamEntry;
    const updated = await saveStampedTeamObject(teamId, "identity", teamEntry.item, { pinned });
    set((s) => ({ teamIdentities: upsertInTeamMap(s.teamIdentities, teamId, updated) }));
  },

  deleteIdentity: async (id) => {
    const teamEntry = findTeamEntry(get().teamIdentities, id);
    if (teamEntry) {
      const { teamId, item: prev } = teamEntry;
      await removeTeamVaultObject(teamId, id);
      set((s) => ({ teamIdentities: removeFromTeamMap(s.teamIdentities, teamId, id) }));
      reportAuditMutation("identity", "deleted", { id: prev.id, name: prev.name ?? prev.username, vault_id: prev.vault_id });
      const prevData = identityToFormData(prev);
      pushDeleteHistory({
        label: `Deleted identity "${prev.name ?? prev.username}"`,
        id,
        data: prevData,
        create: (d) => useIdentityStore.getState().saveIdentity(d),
        remove: (iid) => useIdentityStore.getState().deleteIdentity(iid),
      });
      return;
    }

    const prev = get().identities.find((i) => i.id === id);
    await api.deleteIdentity(id);
    const identities = await api.listIdentities();
    set({ identities });
    const prefs = useSyncPrefsStore.getState();
    isServerMode().then((s) => { if (s && prefs.isObjectSynced(id, "identity")) scheduleSync(); });
    if (prev) reportAuditMutation("identity", "deleted", { id: prev.id, name: prev.name ?? prev.username, vault_id: prev.vault_id });
    if (prev) {
      const prevData = identityToFormData(prev);
      pushDeleteHistory({
        label: `Deleted identity "${prev.name ?? prev.username}"`,
        id,
        data: prevData,
        create: (d) => useIdentityStore.getState().saveIdentity(d),
        remove: (iid) => useIdentityStore.getState().deleteIdentity(iid),
      });
    }
  },
}));
