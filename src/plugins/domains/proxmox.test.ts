import { describe, test, expect, vi, beforeEach } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));

import { createProxmoxAPI } from "./proxmox";

// The real proxmox_* commands require isRemote/localShell (the backend errors when
// isRemote is false and never reads localShell — see src-tauri/src/commands/proxmox.rs)
// and take the snapshot name as "snapname". The domain file hardcodes isRemote:true,
// localShell:null (LXC management only ever runs over an SSH session) and adapts the
// public ProxmoxAPI's "name" argument to "snapname", so those are asserted here too.
describe("createProxmoxAPI", () => {
  beforeEach(() => invoke.mockReset());

  test("lxc.list calls the backing command", async () => {
    invoke.mockResolvedValue([{ vmid: 100 }]);
    await expect(createProxmoxAPI().lxc.list("s1")).resolves.toEqual([{ vmid: 100 }]);
    expect(invoke).toHaveBeenCalledWith("proxmox_lxc_list", {
      sessionId: "s1",
      isRemote: true,
      localShell: null,
    });
  });

  test("lxc.action calls the backing command", async () => {
    invoke.mockResolvedValue(undefined);
    await createProxmoxAPI().lxc.action("s1", 100, "restart");
    expect(invoke).toHaveBeenCalledWith("proxmox_lxc_action", {
      sessionId: "s1",
      isRemote: true,
      localShell: null,
      vmid: 100,
      action: "restart",
    });
  });

  test("lxc.openShell calls the backing command with no isRemote/localShell", async () => {
    invoke.mockResolvedValue("exec-1");
    await expect(createProxmoxAPI().lxc.openShell("s1", 100)).resolves.toBe("exec-1");
    expect(invoke).toHaveBeenCalledWith("proxmox_lxc_open_shell", { sessionId: "s1", vmid: 100 });
  });

  test("snapshots.create maps the optional description through", async () => {
    invoke.mockResolvedValue(undefined);
    await createProxmoxAPI().lxc.snapshots.create("s1", 100, "backup", "before deploy");
    expect(invoke).toHaveBeenCalledWith("proxmox_lxc_snapshot_create", {
      sessionId: "s1",
      isRemote: true,
      localShell: null,
      vmid: 100,
      snapname: "backup",
      description: "before deploy",
    });

    invoke.mockClear();
    await createProxmoxAPI().lxc.snapshots.create("s1", 100, "backup");
    expect(invoke).toHaveBeenCalledWith("proxmox_lxc_snapshot_create", {
      sessionId: "s1",
      isRemote: true,
      localShell: null,
      vmid: 100,
      snapname: "backup",
      description: null,
    });
  });

  // Rollback and delete are separately asserted because swapping them is both easy
  // and destructive — a create-snapshot rollback wired to the delete command (or
  // vice versa) would silently destroy data with no type error to catch it.
  test("snapshot rollback is distinct from snapshot delete", async () => {
    invoke.mockResolvedValue(undefined);
    const api = createProxmoxAPI();

    await api.lxc.snapshots.rollback("s1", 100, "before-upgrade");
    expect(invoke).toHaveBeenCalledWith("proxmox_lxc_snapshot_rollback", {
      sessionId: "s1",
      isRemote: true,
      localShell: null,
      vmid: 100,
      snapname: "before-upgrade",
    });

    invoke.mockClear();
    await api.lxc.snapshots.remove("s1", 100, "before-upgrade");
    expect(invoke).toHaveBeenCalledWith("proxmox_lxc_snapshot_delete", {
      sessionId: "s1",
      isRemote: true,
      localShell: null,
      vmid: 100,
      snapname: "before-upgrade",
    });
    expect(invoke).not.toHaveBeenCalledWith("proxmox_lxc_snapshot_rollback", expect.anything());
  });

  test("snapshots.list calls the backing command", async () => {
    invoke.mockResolvedValue([{ name: "snap1" }]);
    await expect(createProxmoxAPI().lxc.snapshots.list("s1", 100)).resolves.toEqual([{ name: "snap1" }]);
    expect(invoke).toHaveBeenCalledWith("proxmox_lxc_list_snapshots", {
      sessionId: "s1",
      isRemote: true,
      localShell: null,
      vmid: 100,
    });
  });
});
