import i18n from "@/i18n";
import { log } from "@/lib/logger";
import * as connApi from "@/services/connections";
import { listKeys } from "@/services/keys";
import { getDeviceId, isSyncHalted } from "@/services/sync";
import { importIntoVault, reloadKeys } from "@/services/import-export/storeAccess";
import { importedBundle } from "@/services/import-export/formats";
import { parseOpensshFiles, readOpensshFiles, type OpensshFiles } from "@/services/import-export/parsers/openssh";
import { useKeyStore } from "@/stores/keyStore";
import { failed, type DomainResult } from "@/plugins/domains/result";
import { connectionToFormData, useConnectionStore } from "@/stores/connectionStore";
import { APP_SOURCE, useNotificationStore, type BannerEntry } from "@/stores/notificationStore";
import { useSyncPrefsStore } from "@/stores/syncPrefsStore";
import { managedCount, openActivationReview, useSshConfigStore, type SkippedAlias } from "@/stores/sshConfigStore";
import { useVaultStore } from "@/stores/vaultStore";
import { PERSONAL_VAULT, personalVaults } from "@/services/vaultLookup";
import { isTeamVaultId } from "@/stores/teamVaultMap";
import { getPlatform, isMobilePlatform } from "@/utils/platform";
import type { Connection, ConnectionFormData, JumpHost } from "@/types";
import { connectionFieldsOf, fingerprint, identityPaths, jumpHostsOf, keyExportsOf, keylessFingerprint, ownedFieldsOf, ownedFromHash, pickOwned, splitSupported, targetOf } from "./hostFields";
import type { ParsedSshConfig, SshConfigHost } from "./parse";
import { reconcile } from "./reconcile";
import { joinedHere, loadSshConfigState, mergeSshConfigState, presentAt, SEEN_REFRESH_MS, updateSshConfigState, type ManagedEntry, type SshConfigState } from "./state";

export type SyncTrigger = "start" | "poll" | "focus" | "manual" | "mcp" | "switch";
export interface SyncSummary { created: number; updated: number; removed: number; managed: number; skipped: SkippedAlias[] }
export interface SyncDeps { read: typeof readOpensshFiles; sleep: (ms: number) => Promise<void>; now: () => number; device: () => Promise<string> }

const POLL_MS = 30_000;
const STABLE_MS = 1_000;
const FORCED_TRIES = 5;
const FORCED: ReadonlySet<SyncTrigger> = new Set(["manual", "mcp", "switch"]);
const textOf = (f: OpensshFiles) => JSON.stringify([f.config, f.configError, f.includes, f.keys]);

function stateSigOf(state: SshConfigState): string {
  const { connections, teamConnections } = useConnectionStore.getState();
  const byId = new Map([...connections, ...Object.values(teamConnections).flat()].map((c) => [c.id, c]));
  const owned = Object.keys(state.managed ?? {}).map((id) => {
    const c = byId.get(id);
    return c ? [c.vault_id, c.connection_type, c.host, c.port, c.username, c.auth_type, c.identity_id, c.key_id, c.jump_hosts] : null;
  });
  const keys = useKeyStore.getState().keys.map((k) => [k.id, k.vault_id]);
  return JSON.stringify([state.sync, state.managed ?? {}, owned, keys]);
}

const emptyForm = (): ConnectionFormData => ({ tags: [], jump_hosts: [], env_vars: [], agent_forwarding: false, legacy_algorithms: false, ask_vars_each_time: false });

function deleteBlocker(files: OpensshFiles, parsed: ParsedSshConfig, hosts: SshConfigHost[], presentHere: boolean): string | undefined {
  if (files.configError) return "config unreadable";
  if (parsed.skipped.some((n) => n.kind === "include")) return "include unreadable";
  if (hosts.length === 0 && presentHere) return "empty read";
  return undefined;
}

const orPersonal = (id: string | undefined) => id ?? PERSONAL_VAULT.id;

function keyOutsideVault(connections: Connection[], keys: { id: string; vault_id: string }[]): Set<string> {
  const keyVault = new Map(keys.map((k) => [k.id, orPersonal(k.vault_id)]));
  return new Set(connections.filter((c) => !c.key_id || keyVault.get(c.key_id) !== orPersonal(c.vault_id)).map((c) => c.id));
}

const vaultUsable = (id: string) => !isTeamVaultId(id) && personalVaults(useVaultStore.getState().vaults).some((v) => v.id === id);

type BannerSpec = Pick<BannerEntry, "message" | "severity" | "actions">;
let banner: { id: string; message: string } | undefined;
// A banner the user dismissed stays dismissed until its message changes or the problem clears.
function showBanner(next: BannerSpec | undefined) {
  const store = useNotificationStore.getState();
  const live = !!banner && store.banners.some((b) => b.id === banner!.id);
  if (!next) {
    if (live) store.dismissBanner(banner!.id);
    banner = undefined;
  } else if (live) {
    store.updateBanner(banner!.id, next);
    banner!.message = next.message;
  } else if (banner?.message !== next.message) {
    banner = { id: store.addBanner({ source: APP_SOURCE, dismissable: true, ...next }), message: next.message };
  }
}

const showError = (message: string | undefined) => showBanner(message === undefined ? undefined : { message, severity: "error", actions: [] });

function jumpsOf(host: SshConfigHost, all: SshConfigHost[], idOfAlias: Map<string, string>): JumpHost[] {
  return host.proxyJump ? jumpHostsOf(host.proxyJump, all, (ref) => ({ connection_id: (ref && idOfAlias.get(ref.alias)) ?? "" })) : [];
}

function ownedOf(host: SshConfigHost, keyId: string | undefined, all: SshConfigHost[], idOfAlias: Map<string, string>): Partial<ConnectionFormData> {
  const { name: _name, ...fields } = connectionFieldsOf(host);
  return { ...fields, auth_type: keyId ? "key" : "password", identity_id: undefined, key_id: keyId, jump_hosts: jumpsOf(host, all, idOfAlias) };
}

interface KeyNeed { host: SshConfigHost; vault: string }
type KeyIdOf = (vault: string, path: string | undefined) => string | undefined;

async function resolveKeys(needs: KeyNeed[], read: SyncDeps["read"], copyKeys: boolean): Promise<KeyIdOf> {
  const byVault = new Map<string, Map<string, string>>();
  const keyIdOf: KeyIdOf = (vault, path) => (path ? byVault.get(vault)?.get(path) : undefined);
  const all = identityPaths(needs.map((n) => n.host));
  if (all.length === 0) return keyIdOf;
  const files = await read(all, copyKeys ? "read" : "probe");
  for (const vault of new Set(needs.map((n) => n.vault))) {
    const paths = identityPaths(needs.filter((n) => n.vault === vault).map((n) => n.host));
    if (paths.length === 0) continue;
    const { keys, keyRefs, eidOf } = keyExportsOf(paths, files, copyKeys);
    const keyIds = await importIntoVault(importedBundle({ keys, keyRefs }), vault, reloadKeys).then(
      (r) => r.keyIds,
      (e) => {
        log.error(`ssh-config sync could not import keys into ${vault}`, e);
        return new Map<string, string>();
      },
    );
    byVault.set(vault, new Map(paths.flatMap((p) => {
      const id = keyIds.get(eidOf(p));
      return id ? [[p, id] as const] : [];
    })));
  }
  return keyIdOf;
}

export function createSshConfigSync(overrides: Partial<SyncDeps> = {}) {
  const deps: SyncDeps = { read: readOpensshFiles, sleep: (ms) => new Promise((r) => setTimeout(r, ms)), now: Date.now, device: getDeviceId, ...overrides };
  let lastText: string | null = null;
  let lastSig: string | null = null;
  let chain: Promise<SyncSummary | null> = Promise.resolve(null);
  let queued: { trigger: SyncTrigger; run: Promise<SyncSummary | null> } | null = null;
  let stopped = true;
  let unsaved: SshConfigState | null = null;
  let pendingKeys: string[] = [];
  let timer: ReturnType<typeof setInterval> | undefined;
  const onFocus = () => void request("focus");

  // Unresolved keys are re-read without their private half, so a key that appears ends the skip.
  async function readStable(skipUnchanged: boolean, sig: string, tries: number): Promise<OpensshFiles | null> {
    const read = () => deps.read(pendingKeys.length > 0 ? pendingKeys : undefined, "probe");
    let last = await read();
    if (skipUnchanged && textOf(last) === lastText && sig === lastSig) return null;
    for (let i = 0; i < tries; i++) {
      await deps.sleep(STABLE_MS);
      const next = await read();
      if (textOf(next) === textOf(last)) return next;
      last = next;
    }
    return null;
  }

  async function persist(patch: SshConfigState, created: Map<SshConfigHost, Connection>, kept: (id: string) => boolean): Promise<boolean> {
    try {
      await updateSshConfigState(patch);
      return true;
    } catch (e) {
      log.error("ssh-config sync could not save its state; retrying on the next run", e);
      for (const c of created.values()) await connApi.deleteConnection(c.id).catch((err) => log.error(`ssh-config sync could not undo ${c.id}`, err));
      const rest: SshConfigState = { ...patch, managed: Object.fromEntries(Object.entries(patch.managed ?? {}).filter(([id]) => kept(id))) };
      unsaved = unsaved ? mergeSshConfigState(rest, unsaved) : rest;
      return false;
    }
  }

  async function runOnce(trigger: SyncTrigger): Promise<SyncSummary | null> {
    const forced = FORCED.has(trigger);
    const halted = () => (stopped && !forced) || isSyncHalted();
    if (halted()) return null;
    const state = unsaved ? await updateSshConfigState(unsaved) : await loadSshConfigState();
    unsaved = null;
    if (!state.sync?.on) return null;
    const { vault } = state.sync;
    if (!vaultUsable(vault)) {
      lastText = null;
      useSshConfigStore.getState().setStatus({ error: "vault" });
      showError(i18n.t("notifications.sshConfigSync.vaultGone"));
      return null;
    }
    const device = await deps.device();
    if (!joinedHere(state, device)) {
      lastText = null;
      useSshConfigStore.getState().setStatus({ error: "join" });
      showBanner({ message: i18n.t("notifications.sshConfigSync.reviewHere"), severity: "info", actions: [{ label: i18n.t("notifications.sshConfigSync.review"), onClick: openActivationReview }] });
      return null;
    }
    const heartbeatDue = deps.now() - (state.seen?.[device] ?? 0) >= SEEN_REFRESH_MS;
    // Taken before the run, so connections or state that arrive during it still trigger the next one.
    const sig = stateSigOf(state);
    const files = await readStable(!forced && !heartbeatDue, sig, forced ? FORCED_TRIES : 1);
    if (!files || halted()) return null;
    lastText = null;

    const parsed = parseOpensshFiles(files);
    const { hosts, skipped: unsupported } = splitSupported(parsed);
    const now = deps.now();
    const presentHere = Object.values(state.managed ?? {}).some((e) => !e.gone && e.devices[device]?.present);
    const blocker = deleteBlocker(files, parsed, hosts, presentHere);
    const [connections, deleted, keys] = await Promise.all([connApi.listConnections(), connApi.listDeletedConnections(), listKeys()]);
    const rekey = keyOutsideVault(connections, keys);
    const { isObjectSynced } = useSyncPrefsStore.getState();
    const unsynced = new Set(connections.filter((c) => !isObjectSynced(c.id, "connection")).map((c) => c.id));
    const plan = reconcile({ hosts, all: parsed.hosts, connections, deleted, state, device, now, deleteAllowed: !blocker, rekey, unsynced });

    const byId = new Map(connections.map((c) => [c.id, c]));
    const needs: KeyNeed[] = [
      ...plan.creates.map((host) => ({ host, vault })),
      ...plan.updates.filter((u) => u.identityChanged).map((u) => ({ host: u.host, vault: byId.get(u.id)!.vault_id })),
    ];
    const copyKeys = state.sync.copyKeys !== false;
    if (halted() || !(await loadSshConfigState()).sync?.on) return null;
    const keyIdOf = await resolveKeys(needs, deps.read, copyKeys);
    const skipped: SkippedAlias[] = [...unsupported, ...plan.held.map((h) => ({ alias: h.alias, reason: "pending" as const, target: targetOf(h) }))];
    const unresolved = needs.filter(({ host: h, vault: v }) => h.identityFile && !keyIdOf(v, h.identityFile));
    for (const { host: h } of unresolved) skipped.push({ alias: h.alias, reason: copyKeys ? "key" : "keyNotCopied", target: h.identityFile! });

    const applied = new Set([...plan.updates.map((u) => u.id), ...plan.deletes]);
    const managed: Record<string, ManagedEntry> = Object.fromEntries(Object.entries(plan.managed).filter(([id]) => !applied.has(id)));
    const idOfAlias = new Map<string, string>();
    for (const [id, e] of Object.entries({ ...state.managed, ...plan.managed })) if (!e.gone && byId.has(id)) idOfAlias.set(e.alias, id);
    const presence = (host: SshConfigHost, keyId: string | undefined) => presentAt(keyId ? fingerprint(host) : keylessFingerprint(host), now, keyId);

    const created = new Map<SshConfigHost, Connection>();
    let updated = 0;
    let saved = true;
    try {
      for (const host of plan.creates) {
        const keyId = keyIdOf(vault, host.identityFile);
        const saved = await connApi.saveConnection({ ...emptyForm(), ...ownedOf(host, keyId, parsed.hosts, idOfAlias), name: host.alias, vault_id: vault });
        created.set(host, saved);
        idOfAlias.set(host.alias, saved.id);
        managed[saved.id] = { alias: host.alias, at: now, devices: { [device]: presence(host, keyId) } };
      }
      for (const [host, saved] of created) {
        if (host.proxyJump) await connApi.updateConnection(saved.id, { ...connectionToFormData(saved), jump_hosts: jumpsOf(host, parsed.hosts, idOfAlias) });
      }
      for (const u of plan.updates) {
        const c = byId.get(u.id)!;
        const keyId = u.identityChanged ? keyIdOf(c.vault_id, u.host.identityFile) : undefined;
        const keepKey = !!u.host.identityFile && !keyId;
        if (keepKey && !u.drifted && u.was === keylessFingerprint(u.host)) continue;
        const owned = pickOwned(ownedOf(u.host, keyId, parsed.hosts, idOfAlias), ownedFieldsOf(u.host));
        const jumpOwners = [u.was, ...Object.values(state.managed?.[u.id]?.devices ?? {}).map((p) => p.hash)];
        const unjumped = !u.host.proxyJump && jumpOwners.some((h) => ownedFromHash(h).includes("jump_hosts")) ? { jump_hosts: [] } : {};
        const current = keepKey ? { auth_type: c.auth_type, identity_id: c.identity_id, key_id: c.key_id } : {};
        await connApi.updateConnection(u.id, { ...connectionToFormData(c), ...owned, ...unjumped, ...current });
        updated++;
        const e = plan.managed[u.id];
        managed[u.id] = keyId || (keepKey && u.identityChanged) ? { ...e, devices: { ...e.devices, [device]: presence(u.host, keyId) } } : e;
      }
      for (const id of plan.deletes) {
        await connApi.deleteConnection(id);
        managed[id] = plan.managed[id];
      }
    } finally {
      const turnedOff = created.size > 0 && !(await loadSshConfigState().then((s) => s.sync?.on, () => true));
      if (turnedOff) {
        for (const saved of created.values()) managed[saved.id] = { ...managed[saved.id], gone: "detached" };
      }
      const createdIds = new Set([...created.values()].map((c) => c.id));
      const updatedIds = new Set(plan.updates.map((u) => u.id));
      // Rolled-back hosts may be jump targets of this run's updates, so those re-run too.
      const kept = (id: string) => !createdIds.has(id) && (createdIds.size === 0 || !updatedIds.has(id));
      if (Object.keys(managed).length > 0 || heartbeatDue) saved = await persist({ managed, ...(heartbeatDue && { seen: { [device]: now } }) }, created, kept);
    }
    for (const [key, ids] of [["detachedToTeam", plan.detachedToTeam], ["detachedUnsynced", plan.detachedUnsynced], ["detachedProxied", plan.detachedProxied]] as const) {
      if (ids.length > 0) useNotificationStore.getState().addToast({ source: APP_SOURCE, type: "toast", severity: "info", duration: 6000, message: i18n.t(`notifications.sshConfigSync.${key}`, { count: ids.length }) });
    }
    await useConnectionStore.getState().loadConnections();
    const total = managedCount(useSshConfigStore.getState().state);
    useSshConfigStore.getState().setStatus({ lastRead: now, skipped, error: undefined });
    showError(files.configError ? i18n.t("notifications.sshConfigSync.unreadable") : undefined);
    const ids = (list: string[]) => list.join(",") || "-";
    log.info(`ssh-config sync trigger=${trigger} bytes=${files.config?.length ?? 0} aliases=${parsed.hosts.length} created=${ids([...created.values()].map((c) => c.id))} updated=${ids(plan.updates.map((u) => u.id))} deleted=${ids(plan.deletes)} deleteSkipped=${blocker ?? "-"}`);
    const nextPending = identityPaths(unresolved.map((n) => n.host));
    lastText = saved && JSON.stringify(nextPending) === JSON.stringify(pendingKeys) ? textOf(files) : null;
    pendingKeys = nextPending;
    lastSig = sig;
    return { created: saved ? created.size : 0, updated, removed: plan.deletes.length, managed: total, skipped };
  }

  function request(trigger: SyncTrigger): Promise<SyncSummary | null> {
    if (queued) {
      if (FORCED.has(trigger)) queued.trigger = trigger;
      return queued.run;
    }
    const run = chain
      .then(() => {
        const next = queued!.trigger;
        queued = null;
        return runOnce(next);
      })
      .catch((e) => {
        log.error("ssh-config sync failed", e);
        showError(i18n.t("notifications.sshConfigSync.failed"));
        return null;
      });
    queued = { trigger, run };
    chain = run;
    return run;
  }

  return {
    request,
    start() {
      if (!stopped) return;
      stopped = false;
      lastText = null;
      timer = setInterval(() => void request("poll"), POLL_MS);
      window.addEventListener("focus", onFocus);
      void request("start");
    },
    stop() {
      stopped = true;
      clearInterval(timer);
      timer = undefined;
      window.removeEventListener("focus", onFocus);
      showError(undefined);
    },
  };
}

export const sshConfigSync = createSshConfigSync();

export async function sshConfigSyncNow(): Promise<DomainResult<SyncSummary>> {
  if (isMobilePlatform(await getPlatform())) return failed("~/.ssh/config sync runs on desktop only");
  if (!(await loadSshConfigState()).sync?.on) return failed("Continuous sync is off; turn it on in Settings › Hosts");
  const summary = await sshConfigSync.request("mcp");
  return summary ? { ok: true, result: summary } : failed("the sync did not run: it is paused, this computer has not reviewed it yet, or ~/.ssh/config kept changing; see Settings › Hosts");
}

export function startSshConfigSyncEngine(): () => void {
  const follow = (on: boolean | undefined) => (on ? sshConfigSync.start() : sshConfigSync.stop());
  follow(useSshConfigStore.getState().state.sync?.on);
  const unsub = useSshConfigStore.subscribe((s, prev) => {
    if (s.state.sync?.on !== prev.state.sync?.on) follow(s.state.sync?.on);
  });
  return () => {
    unsub();
    sshConfigSync.stop();
  };
}
