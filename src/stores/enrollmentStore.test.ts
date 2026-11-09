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

test("an unreachable server is not cached", async () => {
  h.resolveEnrollment.mockRejectedValue(new Error("offline"));
  await useEnrollmentStore.getState().resolve(TOKEN).catch(() => {});
  h.resolveEnrollment.mockResolvedValue(RESOLVED);
  await expect(useEnrollmentStore.getState().resolve(TOKEN)).resolves.toEqual(RESOLVED);
  expect(h.resolveEnrollment).toHaveBeenCalledTimes(2);
});

test("record keys the outcome by token and account", () => {
  const key = accountKey("https://srv.example/", "acc");
  expect(key).toBe("https://srv.example|acc");
  useEnrollmentStore.getState().record(TOKEN.id, key, "dismissed");
  expect(useEnrollmentStore.getState().records[`${TOKEN.id}|${key}`]).toMatchObject({ outcome: "dismissed" });
});

test("loadMyRequests stores the list, and null when the server lacks the route", async () => {
  h.listMyJoinRequests.mockResolvedValue([{ id: "r" }]);
  await useEnrollmentStore.getState().loadMyRequests();
  expect(useEnrollmentStore.getState().myRequests).toEqual([{ id: "r" }]);
  h.listMyJoinRequests.mockResolvedValue(null);
  await useEnrollmentStore.getState().loadMyRequests();
  expect(useEnrollmentStore.getState().myRequests).toBeNull();
});
