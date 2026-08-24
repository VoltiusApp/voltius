import { scheduleSync } from "@/services/sync";
import { useSyncPrefsStore } from "@/stores/syncPrefsStore";
import { USER_DATA_HANDLERS } from "./registry";
import { domainOf } from "./settingKeys";

// Switching ON publishes: a value curated here while sync was off would
// otherwise lose to the other device's newer timestamp, invisibly.
// Switching OFF pushes too: the copy already on the server has to be withdrawn
// from that blob now, not merely left out of future ones.
function publishOrWithdraw(domain: string, synced: boolean): void {
  if (synced) USER_DATA_HANDLERS.find((h) => h.key === domain)?.touch();
  else scheduleSync();
}

export function setDomainSync(domain: string, synced: boolean): void {
  useSyncPrefsStore.getState().setSyncSettingDomain(domain, synced);
  publishOrWithdraw(domain, synced);
}

export function setKeySync(path: string, synced: boolean): void {
  useSyncPrefsStore.getState().setSettingSync(path, synced);
  publishOrWithdraw(domainOf(path), synced);
}
