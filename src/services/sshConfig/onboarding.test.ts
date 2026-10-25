// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { startSshConfigOnboarding } from "./onboarding";
import { useNotificationStore } from "@/stores/notificationStore";
import { useUIStore } from "@/stores/uiStore";
import * as platform from "@/utils/platform";
import * as state from "./state";
import * as migrate from "./migrate";
import * as notice from "./notice";
import * as sync from "./sync";
import * as openssh from "@/services/import-export/parsers/openssh";
import { log } from "@/lib/logger";

vi.mock("@/utils/platform", () => ({ isMobilePlatform: (p: string | null) => p === "android" || p === "ios", getPlatform: vi.fn() }));
vi.mock("./state", () => ({ loadSshConfigState: vi.fn(), updateSshConfigState: vi.fn(async (p) => p) }));
vi.mock("./migrate", () => ({ migrateFromPlugin: vi.fn(async () => {}) }));
vi.mock("./notice", () => ({ showMigrationNotice: vi.fn() }));
vi.mock("./sync", () => ({ startSshConfigSyncEngine: vi.fn() }));
vi.mock("@/services/import-export/parsers/openssh", async (orig) => ({ ...(await orig<object>()), readOpensshFiles: vi.fn() }));

const stopEngine = vi.fn();
const flush = () => new Promise((r) => setTimeout(r, 0));
const config = { config: "Host a a.example.com\n  HostName x\nHost b\n  HostName y\n", configError: null, includes: {}, keys: {} };

beforeEach(() => {
  vi.clearAllMocks();
  useNotificationStore.setState({ banners: [], inbox: [], toasts: [] } as never);
  vi.mocked(platform.getPlatform).mockResolvedValue("linux");
  vi.mocked(state.loadSshConfigState).mockResolvedValue({});
  vi.mocked(openssh.readOpensshFiles).mockResolvedValue(config);
  vi.mocked(sync.startSshConfigSyncEngine).mockReturnValue(stopEngine);
});

describe("startSshConfigOnboarding", () => {
  it("only loads the state on Android", async () => {
    vi.mocked(platform.getPlatform).mockResolvedValue("android");
    startSshConfigOnboarding();
    await flush();
    expect(state.loadSshConfigState).toHaveBeenCalled();
    expect(migrate.migrateFromPlugin).not.toHaveBeenCalled();
    expect(sync.startSshConfigSyncEngine).not.toHaveBeenCalled();
    expect(useNotificationStore.getState().banners).toHaveLength(0);
  });

  it("starts the sync engine on desktop after the migration and stops it on cleanup", async () => {
    const stop = startSshConfigOnboarding();
    await flush();
    expect(sync.startSshConfigSyncEngine).toHaveBeenCalledTimes(1);
    expect(vi.mocked(migrate.migrateFromPlugin).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(sync.startSshConfigSyncEngine).mock.invocationCallOrder[0]);
    stop();
    expect(stopEngine).toHaveBeenCalled();
  });

  it("migrates first, then offers the import with the host count, reading no keys", async () => {
    startSshConfigOnboarding();
    await flush();
    expect(migrate.migrateFromPlugin).toHaveBeenCalled();
    expect(openssh.readOpensshFiles).toHaveBeenCalledWith();
    const [banner] = useNotificationStore.getState().banners;
    expect(banner.message).toBe(i18n.t("notifications.sshConfigOffer.message", { count: 2 }));
    expect(banner.actions).toHaveLength(2);
  });

  it("records the answer and opens the importer on Import", async () => {
    const open = vi.spyOn(useUIStore.getState(), "openImportExport");
    startSshConfigOnboarding();
    await flush();
    useNotificationStore.getState().banners[0].actions[0].onClick();
    await flush();
    expect(state.updateSshConfigState).toHaveBeenCalledWith({ offer: "accepted" });
    expect(open).toHaveBeenCalledWith("import", { source: "openssh", autoTrigger: true });
  });

  it("records a refusal", async () => {
    startSshConfigOnboarding();
    await flush();
    useNotificationStore.getState().banners[0].actions[1].onClick();
    await flush();
    expect(state.updateSshConfigState).toHaveBeenCalledWith({ offer: "declined" });
  });

  it("shows the pending notice and no offer once answered", async () => {
    vi.mocked(state.loadSshConfigState).mockResolvedValue({ offer: "accepted", migrated: { d: 1 }, notice: "pending" });
    startSshConfigOnboarding();
    await flush();
    expect(notice.showMigrationNotice).toHaveBeenCalled();
    expect(useNotificationStore.getState().banners).toHaveLength(0);
  });

  it("still shows the notice and the offer when the migration fails", async () => {
    vi.mocked(migrate.migrateFromPlugin).mockRejectedValueOnce(new Error("disk"));
    vi.mocked(state.loadSshConfigState).mockResolvedValue({ notice: "pending" });
    startSshConfigOnboarding();
    await flush();
    expect(notice.showMigrationNotice).toHaveBeenCalled();
    expect(useNotificationStore.getState().banners).toHaveLength(1);
  });

  it("logs instead of rejecting when the state cannot be read", async () => {
    const error = vi.spyOn(log, "error").mockImplementation(() => {});
    vi.mocked(state.loadSshConfigState).mockRejectedValueOnce(new Error("unreadable"));
    startSshConfigOnboarding();
    await flush();
    expect(error).toHaveBeenCalled();
    expect(useNotificationStore.getState().banners).toHaveLength(0);
  });

  it("logs a failed answer write", async () => {
    const error = vi.spyOn(log, "error").mockImplementation(() => {});
    vi.mocked(state.updateSshConfigState).mockRejectedValueOnce(new Error("disk")).mockRejectedValueOnce(new Error("disk"));
    startSshConfigOnboarding();
    await flush();
    const [importAction, skipAction] = useNotificationStore.getState().banners[0].actions;
    importAction.onClick();
    skipAction.onClick();
    await flush();
    expect(error).toHaveBeenCalledTimes(2);
  });

  it("offers nothing once continuous sync is on", async () => {
    vi.mocked(state.loadSshConfigState).mockResolvedValue({ sync: { on: true, vault: "personal", at: 1 } });
    startSshConfigOnboarding();
    await flush();
    expect(useNotificationStore.getState().banners).toHaveLength(0);
  });

  it("offers nothing without hosts", async () => {
    vi.mocked(openssh.readOpensshFiles).mockResolvedValue({ config: null, configError: null, includes: {}, keys: {} });
    startSshConfigOnboarding();
    await flush();
    expect(useNotificationStore.getState().banners).toHaveLength(0);
  });

  it("withdraws the offer on cleanup", async () => {
    const stop = startSshConfigOnboarding();
    await flush();
    stop();
    expect(useNotificationStore.getState().banners).toHaveLength(0);
  });
});
