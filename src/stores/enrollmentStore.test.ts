// @vitest-environment jsdom
import { beforeEach, expect, test, vi } from "vitest";

const h = vi.hoisted(() => ({ resolveEnrollment: vi.fn(), listMyJoinRequests: vi.fn() }));
vi.mock("@/services/enrollment/enrollmentPublic", async (orig) => ({
  ...(await orig<typeof import("@/services/enrollment/enrollmentPublic")>()),
  resolveEnrollment: h.resolveEnrollment,
  listMyJoinRequests: h.listMyJoinRequests,
}));

vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));

import { EnrollmentError } from "@/services/enrollment/enrollmentApi";
import { accountKey, useEnrollmentStore } from "./enrollmentStore";

const TOKEN = { serverUrl: "https://srv.example", id: "a".repeat(32), secret: "s".repeat(43) };
const RESOLVED = { teamId: "t1", teamName: "Acme", allowedDomains: [], requireApproval: false };
const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
  vi.useRealTimers();
  h.resolveEnrollment.mockReset();
  h.listMyJoinRequests.mockReset();
  useEnrollmentStore.setState({ resolved: {}, records: {}, myRequests: null });
});

test("resolve cache: second call within 24h does not fetch", async () => {
  h.resolveEnrollment.mockResolvedValue(RESOLVED);
  await useEnrollmentStore.getState().resolve(TOKEN);
  await expect(useEnrollmentStore.getState().resolve(TOKEN)).resolves.toEqual(RESOLVED);
  expect(h.resolveEnrollment).toHaveBeenCalledTimes(1);
});

test("resolve refetches after 24h", async () => {
  vi.useFakeTimers();
  h.resolveEnrollment.mockResolvedValue(RESOLVED);
  await useEnrollmentStore.getState().resolve(TOKEN);
  vi.setSystemTime(Date.now() + DAY + 1000);
  await useEnrollmentStore.getState().resolve(TOKEN);
  expect(h.resolveEnrollment).toHaveBeenCalledTimes(2);
});

test("resolve force refetches", async () => {
  h.resolveEnrollment.mockResolvedValue(RESOLVED);
  await useEnrollmentStore.getState().resolve(TOKEN);
  await useEnrollmentStore.getState().resolve(TOKEN, { force: true });
  expect(h.resolveEnrollment).toHaveBeenCalledTimes(2);
});

test("cached failure is returned without fetch", async () => {
  h.resolveEnrollment.mockRejectedValue(new EnrollmentError("ENROLLMENT_NOT_FOUND", 404));
  await expect(useEnrollmentStore.getState().resolve(TOKEN)).rejects.toBeTruthy();
  const again = await useEnrollmentStore.getState().resolve(TOKEN).catch((e) => e);
  expect(h.resolveEnrollment).toHaveBeenCalledTimes(1);
  expect(useEnrollmentStore.getState().resolved[TOKEN.id].failure).toBe("notFound");
  const { resolveFailure } = await import("@/services/enrollment/enrollmentPublic");
  expect(resolveFailure(again)).toBe("notFound");
});

test("a transient failure is cached for 5 minutes, then refetched", async () => {
  vi.useFakeTimers();
  h.resolveEnrollment.mockRejectedValue(new Error("offline"));
  await useEnrollmentStore.getState().resolve(TOKEN).catch(() => {});
  await useEnrollmentStore.getState().resolve(TOKEN).catch(() => {});
  expect(h.resolveEnrollment).toHaveBeenCalledTimes(1);
  vi.setSystemTime(Date.now() + 5 * 60 * 1000 + 1000);
  await useEnrollmentStore.getState().resolve(TOKEN).catch(() => {});
  expect(h.resolveEnrollment).toHaveBeenCalledTimes(2);
});

test("a 429 waits for Retry-After when it is longer than 5 minutes", async () => {
  vi.useFakeTimers();
  h.resolveEnrollment.mockRejectedValue(new EnrollmentError(null, 429, undefined, 3_600_000));
  await useEnrollmentStore.getState().resolve(TOKEN).catch(() => {});
  vi.setSystemTime(Date.now() + 30 * 60 * 1000);
  await useEnrollmentStore.getState().resolve(TOKEN).catch(() => {});
  expect(h.resolveEnrollment).toHaveBeenCalledTimes(1);
  vi.setSystemTime(Date.now() + 31 * 60 * 1000);
  await useEnrollmentStore.getState().resolve(TOKEN).catch(() => {});
  expect(h.resolveEnrollment).toHaveBeenCalledTimes(2);
});

test("force bypasses a cached transient failure", async () => {
  h.resolveEnrollment.mockRejectedValue(new EnrollmentError(null, 429));
  await useEnrollmentStore.getState().resolve(TOKEN).catch(() => {});
  h.resolveEnrollment.mockResolvedValue(RESOLVED);
  await expect(useEnrollmentStore.getState().resolve(TOKEN, { force: true })).resolves.toEqual(RESOLVED);
});

test("a sticky notFound survives past 24h; a lapsed failure expires", async () => {
  vi.useFakeTimers();
  h.resolveEnrollment.mockRejectedValue(new EnrollmentError("ENROLLMENT_NOT_FOUND", 404));
  await useEnrollmentStore.getState().resolve(TOKEN).catch(() => {});
  vi.setSystemTime(Date.now() + 3 * DAY);
  await useEnrollmentStore.getState().resolve(TOKEN).catch(() => {});
  expect(h.resolveEnrollment).toHaveBeenCalledTimes(1);

  h.resolveEnrollment.mockReset().mockRejectedValue(new EnrollmentError("ENROLLMENT_UNAVAILABLE", 402));
  const other = { ...TOKEN, id: "b".repeat(32) };
  await useEnrollmentStore.getState().resolve(other).catch(() => {});
  vi.setSystemTime(Date.now() + DAY - 1000);
  await useEnrollmentStore.getState().resolve(other).catch(() => {});
  expect(h.resolveEnrollment).toHaveBeenCalledTimes(1);
  vi.setSystemTime(Date.now() + 2000);
  await useEnrollmentStore.getState().resolve(other).catch(() => {});
  expect(h.resolveEnrollment).toHaveBeenCalledTimes(2);
});

test("concurrent resolves of one token fetch once", async () => {
  h.resolveEnrollment.mockResolvedValue(RESOLVED);
  const { resolve } = useEnrollmentStore.getState();
  await Promise.all([resolve(TOKEN), resolve(TOKEN)]);
  expect(h.resolveEnrollment).toHaveBeenCalledTimes(1);
});

test("record keys the outcome by token and account", () => {
  const key = accountKey("https://srv.example/", "acc");
  expect(key).toBe("https://srv.example|acc");
  useEnrollmentStore.getState().record(TOKEN.id, key, "dismissed");
  expect(useEnrollmentStore.getState().records[`${TOKEN.id}|${key}`]).toMatchObject({ outcome: "dismissed" });
});

test("loadMyRequests stores the list, and \"unsupported\" when the server lacks the route", async () => {
  h.listMyJoinRequests.mockResolvedValue([{ id: "r" }]);
  await useEnrollmentStore.getState().loadMyRequests();
  expect(useEnrollmentStore.getState().myRequests).toEqual([{ id: "r" }]);
  h.listMyJoinRequests.mockResolvedValue(null);
  await useEnrollmentStore.getState().loadMyRequests();
  expect(useEnrollmentStore.getState().myRequests).toBe("unsupported");
});

test("dismissed requests persist by request id, apart from token records", () => {
  useEnrollmentStore.setState({ dismissedRequests: [] });
  useEnrollmentStore.getState().dismissRequest("r1");
  useEnrollmentStore.getState().dismissRequest("r1");
  expect(useEnrollmentStore.getState().dismissedRequests).toEqual(["r1"]);
  expect(useEnrollmentStore.getState().records).toEqual({});
  expect(JSON.parse(localStorage.getItem("voltius-enrollment") ?? "{}").state?.dismissedRequests).toEqual(["r1"]);
});

test("loadMyRequests keeps the previous list when the call throws", async () => {
  useEnrollmentStore.setState({ myRequests: [{ id: "kept" } as never] });
  h.listMyJoinRequests.mockRejectedValue(new Error("500"));
  await useEnrollmentStore.getState().loadMyRequests();
  expect(useEnrollmentStore.getState().myRequests).toEqual([{ id: "kept" }]);
});
