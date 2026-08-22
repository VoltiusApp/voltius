import { useSyncPrefsStore } from "@/stores/syncPrefsStore";
import { deletePath, getPath, hasPath, setPath } from "@/utils/dotPath";
import { USER_DATA_HANDLERS } from "./registry";
import { domainOf, keysForDomain, relPath, SETTING_KEYS, type SettingKeyDef } from "./settingKeys";
import type { UserDataBundle, UserDataSection } from "./formats";

// filterOutgoing and filterIncoming both delegate here and are identical
// today. Kept as two functions because a follow-up PR gives them different
// per-key behaviour: outgoing must delete held-back paths from the server
// blob, incoming must not.
function keepSyncedSections(bundle: UserDataBundle): UserDataBundle {
  const { isDomainSynced } = useSyncPrefsStore.getState();
  const sections: Record<string, UserDataSection> = {};
  for (const [key, section] of Object.entries(bundle.sections)) {
    if (isDomainSynced(key)) sections[key] = section;
  }
  return { ...bundle, sections };
}

/**
 * A copy of the bundle whose sections can be edited without touching the
 * caller's. `keepSyncedSections` retains the original section objects by
 * reference; the data is JSON by construction (it is written to settings.json),
 * so a round-trip is a sound deep copy and needs no environment support.
 */
function editableSections(bundle: UserDataBundle, domains: Iterable<string>): UserDataBundle {
  const sections = { ...bundle.sections };
  for (const domain of domains) {
    const section = sections[domain];
    if (section) sections[domain] = { ...section, data: JSON.parse(JSON.stringify(section.data)) };
  }
  return { ...bundle, sections };
}

function notSyncedKeys(): SettingKeyDef[] {
  const { isSettingSynced } = useSyncPrefsStore.getState();
  return SETTING_KEYS.filter((k) => !isSettingSynced(k.id));
}

// Shared by stripHeldBackKeys and restoreLocal: select the not-synced keys
// whose domain is present in the bundle, and make those domains' sections
// editable. Both callers then walk `keys` to apply their own per-key rule.
function heldBackEntries(bundle: UserDataBundle): { keys: SettingKeyDef[]; out: UserDataBundle } {
  const keys = notSyncedKeys().filter((k) => bundle.sections[domainOf(k.id)]);
  const out = keys.length === 0 ? bundle : editableSections(bundle, new Set(keys.map((k) => domainOf(k.id))));
  return { keys, out };
}

function stripHeldBackKeys(bundle: UserDataBundle): UserDataBundle {
  const { keys, out } = heldBackEntries(bundle);
  for (const key of keys) deletePath(out.sections[domainOf(key.id)].data, relPath(key.id));
  return out;
}

/**
 * The bundle as it may leave this device. Written to settings.json before
 * `backup_export` reads it, so a switched-off domain — and any individual
 * setting held back inside a domain that is still syncing — never enters the
 * blob. The guarantee is the filter, not the push trigger.
 */
export function filterOutgoing(bundle: UserDataBundle): UserDataBundle {
  return stripHeldBackKeys(keepSyncedSections(bundle));
}

/**
 * A remote bundle as this device may consider it. Switched-off sections are
 * dropped before the merge, so remote values neither win nor reach the stores.
 *
 * Individual held-back keys are deliberately NOT deleted here: an absent leaf
 * is not "no value" to every importer (`appSettings.import` reads
 * `d.terminal.preferredShell ?? null` inside `if (d.terminal)`), so the apply
 * side re-injects local values instead — see `restoreLocal`.
 */
export function filterIncoming(bundle: UserDataBundle): UserDataBundle {
  return keepSyncedSections(bundle);
}

/**
 * The merged bundle as it may be APPLIED to this device's stores: every
 * held-back path carries this device's own value again, whatever the merge
 * decided. Never applied to the copy written to settings.json — that file is a
 * cache of the merge, and the next push rebuilds it from the stores through
 * `filterOutgoing`.
 */
export function restoreLocal(bundle: UserDataBundle): UserDataBundle {
  const { keys, out } = heldBackEntries(bundle);
  const localByDomain = new Map<string, unknown>();

  for (const key of keys) {
    const domain = domainOf(key.id);
    if (!localByDomain.has(domain)) {
      localByDomain.set(domain, USER_DATA_HANDLERS.find((h) => h.key === domain)?.export());
    }
    const local = localByDomain.get(domain);
    const rel = relPath(key.id);
    const data = out.sections[domain].data;
    // Delete rather than set-undefined when this device has no value: a toggle
    // the user never changed has no entry, and leaving the remote's value in
    // place would apply exactly what the user held back.
    if (hasPath(local, rel)) setPath(data, rel, getPath(local, rel));
    else deletePath(data, rel);
  }
  return out;
}

/**
 * Keys this device is holding back inside a domain that is otherwise syncing.
 * Empty when the domain itself is off — there the domain toggle is the whole
 * story, and listing every key under it would be noise.
 *
 * Exported for the Settings UI so the summary and the filter cannot drift.
 */
export function heldBackKeys(domain: string): SettingKeyDef[] {
  const { isDomainSynced, isSettingSynced } = useSyncPrefsStore.getState();
  if (!isDomainSynced(domain)) return [];
  return keysForDomain(domain).filter((k) => !isSettingSynced(k.id));
}
