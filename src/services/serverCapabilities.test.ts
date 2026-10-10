import { test, expect, vi, beforeEach, afterEach } from "vitest";

const h = vi.hoisted(() => ({ fetchServerMeta: vi.fn(), logged: vi.fn() }));
vi.mock("@/services/teamObjects", () => ({ fetchServerMeta: h.fetchServerMeta }));
vi.mock("@/lib/logger", () => ({ logFailure: () => h.logged }));

import {
  refreshServerCapabilities, resetServerCapabilities, serverLacksSecretType, noteRefusedSecretType,
} from "./serverCapabilities";

beforeEach(() => {
  vi.useFakeTimers();
  Object.values(h).forEach((m) => m.mockReset());
  resetServerCapabilities();
});
afterEach(() => vi.useRealTimers());

test("a type missing from the advertised list is unsupported, a listed one is not", async () => {
  h.fetchServerMeta.mockResolvedValue({ team_secret_types: ["connection_password"] });
  await refreshServerCapabilities();
  expect(serverLacksSecretType("connection_knock_sequence")).toBe(true);
  expect(serverLacksSecretType("connection_password")).toBe(false);
});

test("a server that advertises nothing is not assumed to lack anything", async () => {
  h.fetchServerMeta.mockResolvedValue({ self_hosted: true });
  await refreshServerCapabilities();
  expect(serverLacksSecretType("connection_knock_sequence")).toBe(false);
});

test("a refusal marks only a type that shipped before servers advertised their list", async () => {
  h.fetchServerMeta.mockResolvedValue({ self_hosted: true });
  await refreshServerCapabilities();
  expect(noteRefusedSecretType("connection_password")).toBe(false);
  expect(serverLacksSecretType("connection_password")).toBe(false);
  expect(noteRefusedSecretType("connection_knock_sequence")).toBe(true);
  expect(serverLacksSecretType("connection_knock_sequence")).toBe(true);
});

test("an advertised list outranks a refusal", async () => {
  h.fetchServerMeta.mockResolvedValue({ team_secret_types: ["connection_knock_sequence"] });
  await refreshServerCapabilities();
  expect(noteRefusedSecretType("connection_knock_sequence")).toBe(false);
  expect(serverLacksSecretType("connection_knock_sequence")).toBe(false);
});

test("an upgraded server clears what an older one refused", async () => {
  h.fetchServerMeta.mockResolvedValueOnce({}).mockResolvedValueOnce({ team_secret_types: ["connection_knock_sequence"] });
  await refreshServerCapabilities();
  noteRefusedSecretType("connection_knock_sequence");
  vi.advanceTimersByTime(5 * 60_000);
  await refreshServerCapabilities();
  expect(serverLacksSecretType("connection_knock_sequence")).toBe(false);
});

test("meta is fetched once per interval, and concurrent callers share the request", async () => {
  h.fetchServerMeta.mockResolvedValue({});
  await Promise.all([refreshServerCapabilities(), refreshServerCapabilities()]);
  await refreshServerCapabilities();
  expect(h.fetchServerMeta).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(5 * 60_000);
  await refreshServerCapabilities();
  expect(h.fetchServerMeta).toHaveBeenCalledTimes(2);
});

test("a failed fetch is logged, leaves support unknown, and is retried on the next call", async () => {
  h.fetchServerMeta.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({ team_secret_types: [] });
  await expect(refreshServerCapabilities()).resolves.toBeUndefined();
  expect(h.logged).toHaveBeenCalled();
  expect(serverLacksSecretType("connection_knock_sequence")).toBe(false);
  await refreshServerCapabilities();
  expect(serverLacksSecretType("connection_knock_sequence")).toBe(true);
});

test("a reset forgets the previous server", async () => {
  h.fetchServerMeta.mockResolvedValue({ team_secret_types: [] });
  await refreshServerCapabilities();
  resetServerCapabilities();
  expect(serverLacksSecretType("connection_password")).toBe(false);
  await refreshServerCapabilities();
  expect(h.fetchServerMeta).toHaveBeenCalledTimes(2);
});
