// @vitest-environment jsdom
import { describe, test, expect, vi, beforeEach } from "vitest";
import type { Connection } from "@/types";

const web = { id: "w1", name: "pve", host: "10.0.0.2", port: 8006, username: "", connection_type: "web", web_secure: true } as unknown as Connection;
const ssh = { id: "s1", name: "srv", host: "h1", port: 22, username: "root", password: "pw", connection_type: "ssh" } as unknown as Connection;

const closeWebPane = vi.fn(async (_id: string) => {});
const revealSession = vi.fn((_id: string) => {});
const appToast = vi.fn((..._args: unknown[]) => {});
let mobile = false;

vi.mock("@/services/webHost", () => ({ closeWebPane: (id: string) => closeWebPane(id) }));
vi.mock("@/services/tabActivation", () => ({ revealSession: (id: string) => revealSession(id) }));
vi.mock("@/services/appToast", () => ({ appToast: (...args: unknown[]) => appToast(...args) }));
vi.mock("@/utils/platform", async (orig) => ({ ...(await orig<object>()), isMobileShell: () => mobile }));
vi.mock("@/services/ssh", () => ({
  sshConnect: vi.fn(async () => {}),
  sshDisconnect: vi.fn(async () => true),
  sshDisconnectForReconnect: vi.fn(async () => {}),
  sshDetectDistro: vi.fn(async () => null),
  sshSendInput: vi.fn(async () => {}),
}));
vi.mock("@/services/credentials", () => ({
  resolveConnectionCredentials: vi.fn(async () => ({ username: "root", password: "pw" })),
  resolveJumpHosts: vi.fn(async () => []),
}));
vi.mock("@/stores/connectionStore", () => ({
  useConnectionStore: { getState: () => ({ connections: [web, ssh], teamConnections: {}, setLastUsed: vi.fn(async () => {}) }) },
  connectionToFormData: vi.fn(),
}));
vi.mock("./layoutStore", () => ({
  useLayoutStore: { getState: () => ({ setSplitTabActive: vi.fn(), removeSession: vi.fn() }) },
}));
vi.mock("@/services/hostCommandRun", () => ({ runHostCommand: vi.fn(async () => {}) }));
vi.mock("@/services/auditReporter", () => ({ reportAuditClientEvent: vi.fn() }));
vi.mock("@/services/auditContextResolver", () => ({ auditContextForVaultId: vi.fn(() => ({})) }));

import { useSessionStore } from "./sessionStore";

beforeEach(() => {
  vi.clearAllMocks();
  mobile = false;
  useSessionStore.setState({ sessions: [], activeSessionId: null });
});

describe("web host sessions", () => {
  test("connect returns the id of the web tab it opened", async () => {
    const id = await useSessionStore.getState().connect("w1");
    const [session] = useSessionStore.getState().sessions;
    expect(session).toMatchObject({ id, type: "web", webUrl: "https://10.0.0.2:8006/" });
  });

  test("connecting connected hosts returns ids that all exist", async () => {
    const ids = await useSessionStore.getState().connectMany(["s1", "w1"]);
    const existing = useSessionStore.getState().sessions.map((s) => s.id);
    expect(ids.every((id) => existing.includes(id))).toBe(true);
  });

  test("reopening a web host reveals its existing tab, wherever it lives", async () => {
    const first = await useSessionStore.getState().connect("w1");
    const second = await useSessionStore.getState().connect("w1");
    expect(second).toBe(first);
    expect(useSessionStore.getState().sessions).toHaveLength(1);
    expect(revealSession).toHaveBeenCalledWith(first);
  });

  test("the page closes whichever way its session goes away", async () => {
    const a = await useSessionStore.getState().connect("w1");
    useSessionStore.getState().removeSession(a);
    expect(closeWebPane).toHaveBeenCalledWith(a);

    const b = await useSessionStore.getState().connect("w1");
    await useSessionStore.getState().disconnect(b);
    expect(closeWebPane).toHaveBeenCalledWith(b);
  });

  test("on mobile no web tab opens and the user is told why", async () => {
    mobile = true;
    await useSessionStore.getState().connect("w1");
    expect(useSessionStore.getState().sessions).toHaveLength(0);
    expect(appToast).toHaveBeenCalledWith("info", expect.any(String));
  });
});
