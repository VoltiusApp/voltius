import { create } from "zustand";
import { getPlatform } from "@/utils/platform";
import { useLanSyncStore } from "@/stores/lanSyncStore";

export const useLanSyncIntroStore = create<{ open: boolean }>(() => ({ open: false }));

let pending: Promise<void> | null = null;
let resolvePending: (() => void) | null = null;

export function confirmLanSyncIntro(): void {
  useLanSyncStore.getState().setIntroShown(true);
  useLanSyncIntroStore.setState({ open: false });
  resolvePending?.();
}

export async function ensureLanSyncIntro(): Promise<void> {
  const platform = await getPlatform();
  if (platform !== "macos" && platform !== "windows") return;
  if (useLanSyncStore.getState().introShown) return;
  pending ??= new Promise<void>((resolve) => {
    resolvePending = () => {
      pending = null;
      resolvePending = null;
      resolve();
    };
    useLanSyncIntroStore.setState({ open: true });
  });
  return pending;
}
