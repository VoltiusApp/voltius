import type { SyncProviderState, SyncProviderStatus } from "@/plugins/api";

export type SyncStatus = SyncProviderStatus;

export interface GistSyncState extends SyncProviderState {
  lastSync: Date | null;
}
