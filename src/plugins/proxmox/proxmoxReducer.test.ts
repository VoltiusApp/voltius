import { reducer, initial } from "./proxmoxReducer.ts";

function assertEqual<T>(actual: T, expected: T, msg: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`FAIL ${msg}\n  expected ${e}\n  actual   ${a}`);
}

{
  const s = reducer({ ...initial, error: "x", snapshots: [{ name: "old", timestamp: null, description: "", is_current: false }] },
    { type: "OPEN_SNAPSHOTS", vmid: 101, vmName: "web" });
  assertEqual(s.view, "snapshots", "OPEN_SNAPSHOTS view");
  assertEqual(s.selectedVmid, 101, "OPEN_SNAPSHOTS vmid");
  assertEqual(s.selectedVmName, "web", "OPEN_SNAPSHOTS name");
  assertEqual(s.snapshots, [], "OPEN_SNAPSHOTS clears snapshots");
  assertEqual(s.error, null, "OPEN_SNAPSHOTS clears error");
}

{
  const s = reducer({ ...initial, view: "snapshots", selectedVmid: 5, selectedVmName: "db" }, { type: "CLOSE_SNAPSHOTS" });
  assertEqual(s.view, "containers", "CLOSE view");
  assertEqual(s.selectedVmid, null, "CLOSE vmid");
  assertEqual(s.selectedVmName, "", "CLOSE name");
}

{
  const s = reducer({ ...initial, loading: true, error: "boom" }, { type: "SET_CONTAINERS", containers: [] });
  assertEqual(s.loading, false, "SET_CONTAINERS loading");
  assertEqual(s.error, null, "SET_CONTAINERS error");
}

{
  const s = reducer({ ...initial, loading: true }, { type: "SET_ERROR", error: "nope" });
  assertEqual(s.error, "nope", "SET_ERROR error");
  assertEqual(s.loading, false, "SET_ERROR loading");
}

{
  const base = { ...initial, containers: [{ vmid: 1, name: "a", status: "running", mem_mb: 0, disk_gb: 0, pid: 0 }] };
  const s = reducer(base, { type: "RESET" });
  assertEqual(s, initial, "RESET to initial");
}

console.log("ok");
