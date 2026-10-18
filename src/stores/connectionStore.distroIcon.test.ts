// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Connection } from "@/types";

const h = vi.hoisted(() => ({
  setConnectionDistro: vi.fn(async () => {}),
  saveTeamVaultObject: vi.fn(async () => {}),
}));
vi.mock("@/services/connections", () => ({ setConnectionDistro: h.setConnectionDistro }));
vi.mock("@/services/teamObjectPersistence", () => ({
  saveTeamVaultObject: h.saveTeamVaultObject,
  removeTeamVaultObject: vi.fn(),
}));
vi.mock("@/services/account", () => ({ isServerMode: async () => false }));
vi.mock("@/services/sync", () => ({ scheduleSync: vi.fn() }));

import { connectionFromForm, detectionChangesDistro, useConnectionStore } from "./connectionStore";

const host = (over: Partial<Connection>): Connection =>
  connectionFromForm({ host: "h", port: 22, username: "u", tags: [], ...over }, { id: "c1", now: "t0" }) as Connection;

describe("host icon follows the detected distro", () => {
  beforeEach(() => {
    h.setConnectionDistro.mockClear();
    useConnectionStore.setState({ connections: [], teamConnections: {} });
  });

  it("drops an icon that was copied from the old distro", async () => {
    useConnectionStore.setState({ connections: [host({ distro: "ubuntu", icon: "ubuntu" })] });
    await useConnectionStore.getState().setDistro("c1", "debian");
    expect(h.setConnectionDistro).toHaveBeenCalledWith("c1", "debian", true);
    const c = useConnectionStore.getState().connections[0];
    expect(c.distro).toBe("debian");
    expect(c.icon).toBeUndefined();
  });

  it("keeps an icon the user picked", async () => {
    useConnectionStore.setState({ connections: [host({ distro: "ubuntu", icon: "docker" })] });
    await useConnectionStore.getState().setDistro("c1", "debian");
    expect(h.setConnectionDistro).toHaveBeenCalledWith("c1", "debian", false);
    expect(useConnectionStore.getState().connections[0].icon).toBe("docker");
  });

  it("applies the same rule to a team vault host", async () => {
    useConnectionStore.setState({ teamConnections: { t1: [host({ distro: "ubuntu", icon: "ubuntu", vault_id: "t1" })] } });
    await useConnectionStore.getState().setDistro("c1", "debian");
    const c = useConnectionStore.getState().teamConnections.t1[0];
    expect(c.distro).toBe("debian");
    expect(c.icon).toBeUndefined();
    expect(h.setConnectionDistro).not.toHaveBeenCalled();
  });

  it("a reinstalled host picks up the newly detected distro on connect", async () => {
    useConnectionStore.setState({ connections: [host({ distro: "ubuntu", icon: "ubuntu" })] });
    await useConnectionStore.getState().setDistro("c1", "debian", { detected: true });
    const c = useConnectionStore.getState().connections[0];
    expect(c.distro).toBe("debian");
    expect(c.icon).toBeUndefined();
  });

  it("an unchanged detection writes nothing", async () => {
    useConnectionStore.setState({ connections: [host({ distro: "debian" })] });
    await useConnectionStore.getState().setDistro("c1", "debian", { detected: true });
    expect(h.setConnectionDistro).not.toHaveBeenCalled();
  });

  it("the generic linux fallback never replaces a saved distro", () => {
    expect(detectionChangesDistro("freebsd", "linux")).toBe(false);
    expect(detectionChangesDistro(undefined, "linux")).toBe(true);
    expect(detectionChangesDistro("", "linux")).toBe(true);
    expect(detectionChangesDistro("ubuntu", "debian")).toBe(true);
    expect(detectionChangesDistro("debian", "debian")).toBe(false);
  });

  it("an empty icon from the form clears the saved one", () => {
    const prev = host({ distro: "ubuntu", icon: "docker" });
    const next = connectionFromForm({ host: "h", port: 22, username: "u", tags: [], icon: "" }, { id: "c1", now: "t1", prev });
    expect(next.icon).toBeUndefined();
  });
});
