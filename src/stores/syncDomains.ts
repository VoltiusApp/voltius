// ─── Registry ────────────────────────────────────────────────────────────────
// Add new syncable object types here. SyncSection reads this automatically;
// labels live in settings.sync.objectType.<id>.{label,sub}.

export interface SyncObjectTypeDef {
  id: string;
}

export const SYNC_OBJECT_TYPES: SyncObjectTypeDef[] = [
  { id: "connection" },
  { id: "identity" },
  { id: "key" },
  { id: "folder" },
  { id: "snippet" },
  { id: "port-forwarding-rule" },
];

export interface SyncSettingDomainDef {
  /** Handler key from USER_DATA_HANDLERS. */
  id: string;
}

// `vaults` is deliberately absent: it is tombstone-merged data, not a
// preference, and switching it off would strand deletes on this device.
export const SYNC_SETTING_DOMAINS: SyncSettingDomainDef[] = [
  { id: "themes" },
  { id: "uiPreferences" },
  { id: "shortcuts" },
  { id: "appSettings" },
  { id: "recentPeople" },
];
