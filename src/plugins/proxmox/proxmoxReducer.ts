import type { LxcContainer, LxcSnapshot, ProxmoxState } from "./types";

export type Action =
  | { type: "SET_CONTAINERS"; containers: LxcContainer[] }
  | { type: "SET_SNAPSHOTS"; snapshots: LxcSnapshot[] }
  | { type: "OPEN_SNAPSHOTS"; vmid: number; vmName: string }
  | { type: "CLOSE_SNAPSHOTS" }
  | { type: "SET_LOADING"; loading: boolean }
  | { type: "SET_ERROR"; error: string | null }
  | { type: "SET_SNAPSHOT_INPUT"; value: string }
  | { type: "SET_SNAPSHOT_DESC"; value: string }
  | { type: "RESET" };

export const initial: ProxmoxState = {
  view: "containers",
  containers: [],
  snapshots: [],
  selectedVmid: null,
  selectedVmName: "",
  loading: false,
  error: null,
  snapshotInput: "",
  snapshotInputDesc: "",
};

export function reducer(state: ProxmoxState, action: Action): ProxmoxState {
  switch (action.type) {
    case "SET_CONTAINERS":
      return { ...state, containers: action.containers, loading: false, error: null };
    case "SET_SNAPSHOTS":
      return { ...state, snapshots: action.snapshots, loading: false, error: null };
    case "OPEN_SNAPSHOTS":
      return { ...state, view: "snapshots", selectedVmid: action.vmid, selectedVmName: action.vmName, snapshots: [], error: null };
    case "CLOSE_SNAPSHOTS":
      return { ...state, view: "containers", selectedVmid: null, selectedVmName: "", snapshots: [] };
    case "SET_LOADING":
      return { ...state, loading: action.loading };
    case "SET_ERROR":
      return { ...state, error: action.error, loading: false };
    case "SET_SNAPSHOT_INPUT":
      return { ...state, snapshotInput: action.value };
    case "SET_SNAPSHOT_DESC":
      return { ...state, snapshotInputDesc: action.value };
    case "RESET":
      return { ...initial };
    default:
      return state;
  }
}
