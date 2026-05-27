import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useAppSettingsTimestampStore } from "./appSettingsTimestampStore";

interface PortForwardingSettingsStore {
  autoForwardEnabled: boolean;
  autoForwardNotificationsEnabled: boolean;
  setAutoForwardEnabled: (v: boolean) => void;
  setAutoForwardNotificationsEnabled: (v: boolean) => void;
}

export const usePortForwardingSettingsStore = create<PortForwardingSettingsStore>()(
  persist(
    (set) => ({
      autoForwardEnabled: true,
      autoForwardNotificationsEnabled: false,
      setAutoForwardEnabled: (v) => { set({ autoForwardEnabled: v }); useAppSettingsTimestampStore.getState().touch(); },
      setAutoForwardNotificationsEnabled: (v) => { set({ autoForwardNotificationsEnabled: v }); useAppSettingsTimestampStore.getState().touch(); },
    }),
    { name: "voltius-port-forwarding-settings" },
  ),
);
