import type { GlobalPanelHandle } from "@/plugins/api";

export interface FakePanelHandle {
  handle: GlobalPanelHandle;
  state: { open: boolean; dockedWidth: number; disposed: boolean };
}

/** A stateful stand-in for the host's registerGlobalPanel handle. */
export function fakePanelHandle(id = "plugin-ai-agent:drawer"): FakePanelHandle {
  const state = { open: false, dockedWidth: 0, disposed: false };
  const handle = (() => {
    state.disposed = true;
  }) as GlobalPanelHandle;
  Object.assign(handle, {
    id,
    open: () => {
      state.open = true;
    },
    close: () => {
      state.open = false;
    },
    toggle: () => {
      state.open = !state.open;
    },
    isOpen: () => state.open,
    setDockedWidth: (width: number) => {
      state.dockedWidth = width;
    },
  });
  return { handle, state };
}
