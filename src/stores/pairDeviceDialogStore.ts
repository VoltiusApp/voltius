import { create } from "zustand";

export const usePairDeviceDialogStore = create<{ open: boolean }>(() => ({ open: false }));

export const openPairDeviceDialog = () => usePairDeviceDialogStore.setState({ open: true });
export const closePairDeviceDialog = () => usePairDeviceDialogStore.setState({ open: false });
