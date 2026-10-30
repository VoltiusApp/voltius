import { create } from "zustand";
import type { LanRoute } from "@/services/lanSyncDevices";

export interface AllowedDevice {
  deviceKey: string;
  name: string;
  always: boolean;
  lastOpened: string | null;
}

export interface FileAccessConfig {
  enabled: boolean;
  folders: string[];
  readOnly: boolean;
  allowed: AllowedDevice[];
  seenKeys: string[];
}

export interface ApprovalPrompt {
  requestId: string;
  deviceKey: string;
  deviceName: string;
  platform: string;
  route: LanRoute;
  newDevice: boolean;
}

export interface ActiveSession {
  deviceKey: string;
  deviceName: string;
  since: string;
}

export type FileAnswer = "once" | "always" | "deny";

interface DeviceFilesStore {
  config: FileAccessConfig | null;
  pending: ApprovalPrompt[];
  sessions: ActiveSession[];
  setConfig: (config: FileAccessConfig | null) => void;
  setPending: (pending: ApprovalPrompt[]) => void;
  setSessions: (sessions: ActiveSession[]) => void;
  reset: () => void;
}

const EMPTY = { config: null, pending: [], sessions: [] };

export const useDeviceFilesStore = create<DeviceFilesStore>()((set) => ({
  ...EMPTY,
  setConfig: (config) => set({ config }),
  setPending: (pending) => set({ pending }),
  setSessions: (sessions) => set({ sessions }),
  reset: () => set(EMPTY),
}));
