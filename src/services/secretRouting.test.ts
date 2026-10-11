import { test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  getLocalSecret: vi.fn(),
  storeLocalSecret: vi.fn(),
  deleteLocalSecret: vi.fn(),
  saveTeamVaultSecret: vi.fn(),
  resolveTeamIdForVaultId: vi.fn(),
  deleteTeamSecret: vi.fn(),
  fetchServerMeta: vi.fn(),
  logged: vi.fn(),
  warned: vi.fn(),
}));
vi.mock("@/services/vault", () => ({
  getLocalSecret: h.getLocalSecret,
  storeLocalSecret: h.storeLocalSecret,
  deleteLocalSecret: h.deleteLocalSecret,
}));
vi.mock("@/services/teamVaultSecrets", () => ({
  saveTeamVaultSecret: h.saveTeamVaultSecret,
  resolveTeamIdForVaultId: h.resolveTeamIdForVaultId,
}));
vi.mock("@/services/teamObjects", () => ({ deleteTeamSecret: h.deleteTeamSecret, fetchServerMeta: h.fetchServerMeta }));
vi.mock("@/lib/logger", () => ({ logFailure: () => h.logged, log: { warn: h.warned } }));
vi.mock("@/services/clientHeaders", () => ({ clientVersion: async () => "9.9.9" }));
vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));

import {
  readSecretAt, writeSecretAt, removeSecretAt, retryUnsentTeamSecrets, reportUploadFailure,
  TeamSecretUploadError, TeamSecretUnsupportedError,
} from "./secretRouting";
import { useNotificationStore } from "@/stores/notificationStore";
import { teamSecretCache } from "./teamSecretCache";
import { resetServerCapabilities, serverLacksSecretType } from "./serverCapabilities";
import { usePendingTeamSecretUploadStore } from "@/stores/pendingTeamSecretUploadStore";

beforeEach(() => {
  Object.values(h).forEach((m) => m.mockReset());
  teamSecretCache.clearAll();
  usePendingTeamSecretUploadStore.getState().clearAll();
  resetServerCapabilities();
  useNotificationStore.setState({ toasts: [] });
  h.fetchServerMeta.mockResolvedValue({});
});

test("a team-owned key is never read from the local store, even when it has a value", async () => {
  h.getLocalSecret.mockResolvedValue("stale-local");
  await expect(readSecretAt("t1", "password:c1")).resolves.toBeNull();
  teamSecretCache.set("t1", "password:c1", "served");
  await expect(readSecretAt("t1", "password:c1")).resolves.toBe("served");
  expect(h.getLocalSecret).not.toHaveBeenCalled();
});

test("a personal key reads the local store", async () => {
  h.getLocalSecret.mockResolvedValue("pw");
  await expect(readSecretAt(null, "password:c1")).resolves.toBe("pw");
});

test("a team write caches, uploads, and never touches the local store", async () => {
  h.saveTeamVaultSecret.mockResolvedValue(undefined);
  await writeSecretAt("t1", "password:c1", "pw");
  expect(teamSecretCache.get("t1", "password:c1")).toBe("pw");
  expect(h.saveTeamVaultSecret).toHaveBeenCalledWith("t1", "password:c1", "pw");
  expect(h.storeLocalSecret).not.toHaveBeenCalled();
});

const failing = (status?: number) => Object.assign(new Error(`upload failed ${status ?? "offline"}`), status ? { status } : {});

test.each([undefined, 500, 503, 401, 408, 429])("an upload the server never answered (%s) stays usable and unsent", async (status) => {
  teamSecretCache.set("t1", "password:c1", "served");
  h.saveTeamVaultSecret.mockRejectedValue(failing(status));

  const err = await writeSecretAt("t1", "password:c1", "pw").catch((e) => e);

  expect(err).toBeInstanceOf(TeamSecretUploadError);
  expect(err.localKey).toBe("password:c1");
  expect(err.pending).toBe(true);
  expect(err.message).toBe("common.error.teamSecretUploadPending");
  expect(teamSecretCache.get("t1", "password:c1")).toBe("pw");
  expect([...teamSecretCache.unsent("t1")]).toEqual([["password:c1", "pw"]]);
  expect(h.storeLocalSecret).not.toHaveBeenCalled();
  expect(h.warned.mock.calls[0].join(" ")).toContain("password:c1");
});

test.each([400, 402, 403, 404, 413, 426])("an upload the server refused (%s) shows what the server holds again", async (status) => {
  teamSecretCache.set("t1", "password:c1", "served");
  h.saveTeamVaultSecret.mockRejectedValue(failing(status));

  const err = await writeSecretAt("t1", "password:c1", "pw").catch((e) => e);

  expect(err).toBeInstanceOf(TeamSecretUploadError);
  expect(err.pending).toBe(false);
  expect(err.message).toBe("common.error.teamSecretRefused");
  expect(teamSecretCache.get("t1", "password:c1")).toBe("served");
  expect(teamSecretCache.unsent("t1").size).toBe(0);
});

test("a refused value the server never held is gone", async () => {
  h.saveTeamVaultSecret.mockRejectedValue(failing(403));
  await expect(writeSecretAt("t1", "password:c1", "pw")).rejects.toBeInstanceOf(TeamSecretUploadError);
  expect(teamSecretCache.get("t1", "password:c1")).toBeUndefined();
});

test("a reload of the team keeps an unsent value, and the retry uploads it", async () => {
  h.saveTeamVaultSecret.mockRejectedValueOnce(failing());
  await writeSecretAt("t1", "password:c1", "pw").catch(() => {});
  teamSecretCache.replaceTeam("t1", new Map([["password:c1", "served"]]));
  expect(teamSecretCache.get("t1", "password:c1")).toBe("pw");

  h.saveTeamVaultSecret.mockResolvedValue(undefined);
  await retryUnsentTeamSecrets("t1");

  expect(h.saveTeamVaultSecret).toHaveBeenLastCalledWith("t1", "password:c1", "pw");
  expect(teamSecretCache.unsent("t1").size).toBe(0);
  expect(teamSecretCache.entries("t1").get("password:c1")).toBe("pw");
});

test("the retry drops a value the server now refuses and stops once the server is out of reach", async () => {
  h.saveTeamVaultSecret.mockRejectedValue(failing());
  for (const key of ["password:c1", "password:c2", "password:c3"]) await writeSecretAt("t1", key, "pw").catch(() => {});
  h.saveTeamVaultSecret.mockReset();
  h.saveTeamVaultSecret.mockRejectedValueOnce(failing(404)).mockRejectedValueOnce(failing(503));

  await retryUnsentTeamSecrets("t1");

  expect(h.saveTeamVaultSecret).toHaveBeenCalledTimes(2);
  expect([...teamSecretCache.unsent("t1").keys()]).toEqual(["password:c2", "password:c3"]);
});

test("the retry leaves a key queued by a move to the sweep that owns its local copy", async () => {
  usePendingTeamSecretUploadStore.getState().enqueue("t1", ["password:c1"]);
  h.saveTeamVaultSecret.mockRejectedValue(failing());
  h.storeLocalSecret.mockResolvedValue(undefined);
  await writeSecretAt("t1", "password:c1", "pw").catch(() => {});
  h.saveTeamVaultSecret.mockClear();

  await retryUnsentTeamSecrets("t1");

  expect(h.saveTeamVaultSecret).not.toHaveBeenCalled();
});

test("a value cleared while unsent is never uploaded later, even when the delete fails", async () => {
  teamSecretCache.set("t1", "password:c1", "served");
  h.saveTeamVaultSecret.mockRejectedValue(failing());
  await writeSecretAt("t1", "password:c1", "pw").catch(() => {});
  h.deleteTeamSecret.mockRejectedValue(new Error("offline"));

  await expect(removeSecretAt("t1", "password:c1")).rejects.toThrow("offline");

  expect(teamSecretCache.unsent("t1").size).toBe(0);
  expect(teamSecretCache.get("t1", "password:c1")).toBe("served");
});

test("a personal write goes to the local store only", async () => {
  await writeSecretAt(null, "password:c1", "pw");
  expect(h.storeLocalSecret).toHaveBeenCalledWith("password:c1", "pw");
  expect(h.saveTeamVaultSecret).not.toHaveBeenCalled();
});

test("a team delete removes the server row, then the cached value", async () => {
  teamSecretCache.set("t1", "key:k1:private", "pem");
  h.deleteTeamSecret.mockResolvedValue(undefined);
  await removeSecretAt("t1", "key:k1:private");
  expect(h.deleteTeamSecret).toHaveBeenCalledWith("t1", "key:k1:private");
  expect(teamSecretCache.get("t1", "key:k1:private")).toBeUndefined();
  expect(h.deleteLocalSecret).not.toHaveBeenCalled();
});

test("a failed team delete keeps the cache in step with the server", async () => {
  teamSecretCache.set("t1", "password:c1", "pw");
  h.deleteTeamSecret.mockRejectedValue(new Error("500"));
  await expect(removeSecretAt("t1", "password:c1")).rejects.toThrow("500");
  expect(teamSecretCache.get("t1", "password:c1")).toBe("pw");
});

test("a personal delete goes to the local store", async () => {
  await removeSecretAt(null, "password:c1");
  expect(h.deleteLocalSecret).toHaveBeenCalledWith("password:c1");
});

test("reportUploadFailure swallows only upload failures, and says so once", () => {
  const handler = reportUploadFailure("ctx");
  const failure = new TeamSecretUploadError("password:c1", new Error("x"), "not uploaded");
  expect(() => handler(failure)).not.toThrow();
  handler(new TeamSecretUploadError("password:c2", new Error("x"), "not uploaded"));
  expect(h.logged).toHaveBeenCalledTimes(2);
  expect(useNotificationStore.getState().toasts.map((toast) => [toast.message, toast.severity])).toEqual([["not uploaded", "error"]]);
  expect(() => handler(new Error("vault locked"))).toThrow("vault locked");
});

test("reportUploadFailure warns about a pending upload and can stay quiet", () => {
  const pending = Object.assign(new TeamSecretUploadError("password:c1", new Error("x"), "later"), { pending: true });
  reportUploadFailure("ctx", { toast: false })(pending);
  expect(useNotificationStore.getState().toasts).toEqual([]);
  reportUploadFailure("ctx")(pending);
  expect(useNotificationStore.getState().toasts[0].severity).toBe("warning");
});

const pendingIn = (teamId: string) => usePendingTeamSecretUploadStore.getState().keysByTeamId[teamId] ?? [];

test("a successful upload of a key queued for retry settles it, so the retry never re-uploads an older copy", async () => {
  usePendingTeamSecretUploadStore.getState().enqueue("t1", ["password:c1", "key:c1"]);
  usePendingTeamSecretUploadStore.getState().enqueue("t2", ["password:c1"]);
  h.saveTeamVaultSecret.mockResolvedValue(undefined);

  await writeSecretAt("t1", "password:c1", "newest");

  expect(pendingIn("t1")).toEqual(["key:c1"]);
  expect(pendingIn("t2")).toEqual(["password:c1"]);
  expect(h.storeLocalSecret).not.toHaveBeenCalled();
});

test("a failed upload of a key queued for retry refreshes the local copy the retry will upload", async () => {
  usePendingTeamSecretUploadStore.getState().enqueue("t1", ["password:c1"]);
  h.saveTeamVaultSecret.mockRejectedValue(new Error("503"));
  h.storeLocalSecret.mockResolvedValue(undefined);

  await expect(writeSecretAt("t1", "password:c1", "newest")).rejects.toBeInstanceOf(TeamSecretUploadError);

  expect(h.storeLocalSecret).toHaveBeenCalledWith("password:c1", "newest");
  expect(pendingIn("t1")).toEqual(["password:c1"]);
});

const refused400 = () => Object.assign(new Error("Failed to save team secret: 400"), { status: 400 });

test("a type the server does not advertise is never uploaded, and the cache keeps what the server holds", async () => {
  h.fetchServerMeta.mockResolvedValue({ team_secret_types: ["connection_password"] });
  teamSecretCache.set("t1", "knock_sequence:c1", "1/tcp");

  const err = await writeSecretAt("t1", "knock_sequence:c1", "666/tcp").catch((e) => e);

  expect(err).toBeInstanceOf(TeamSecretUnsupportedError);
  expect(err).toBeInstanceOf(TeamSecretUploadError);
  expect(err.message).toBe("common.error.serverLacksTeamSecretType");
  expect(h.saveTeamVaultSecret).not.toHaveBeenCalled();
  expect(teamSecretCache.get("t1", "knock_sequence:c1")).toBe("1/tcp");
  expect(h.warned.mock.calls[0].join(" ")).toContain("connection_knock_sequence");
  expect(h.warned.mock.calls[0].join(" ")).toContain("9.9.9");
});

test("a 400 from a server too old to advertise its types drops the unsaved value and is remembered", async () => {
  h.saveTeamVaultSecret.mockRejectedValue(refused400());

  await expect(writeSecretAt("t1", "knock_sequence:c1", "666/tcp")).rejects.toBeInstanceOf(TeamSecretUnsupportedError);

  expect(teamSecretCache.get("t1", "knock_sequence:c1")).toBeUndefined();
  expect(serverLacksSecretType("connection_knock_sequence")).toBe(true);
});

test("a 400 for a type every server stores is an ordinary refusal", async () => {
  h.saveTeamVaultSecret.mockRejectedValue(refused400());

  const err = await writeSecretAt("t1", "password:c1", "pw").catch((e) => e);

  expect(err).toBeInstanceOf(TeamSecretUploadError);
  expect(err).not.toBeInstanceOf(TeamSecretUnsupportedError);
  expect(serverLacksSecretType("connection_password")).toBe(false);
  expect(teamSecretCache.get("t1", "password:c1")).toBeUndefined();
});

test("an unsupported type queued for retry stays readable here and keeps its local copy current", async () => {
  usePendingTeamSecretUploadStore.getState().enqueue("t1", ["knock_sequence:c1"]);
  h.saveTeamVaultSecret.mockRejectedValue(refused400());
  h.storeLocalSecret.mockResolvedValue(undefined);

  await expect(writeSecretAt("t1", "knock_sequence:c1", "666/tcp")).rejects.toBeInstanceOf(TeamSecretUnsupportedError);

  expect(teamSecretCache.get("t1", "knock_sequence:c1")).toBe("666/tcp");
  expect(h.storeLocalSecret).toHaveBeenCalledWith("knock_sequence:c1", "666/tcp");
  expect(pendingIn("t1")).toEqual(["knock_sequence:c1"]);
});

test("an unreachable meta endpoint never blocks an upload", async () => {
  h.fetchServerMeta.mockRejectedValue(new Error("offline"));
  h.saveTeamVaultSecret.mockResolvedValue(undefined);

  await writeSecretAt("t1", "knock_sequence:c1", "666/tcp");

  expect(h.saveTeamVaultSecret).toHaveBeenCalledWith("t1", "knock_sequence:c1", "666/tcp");
});
