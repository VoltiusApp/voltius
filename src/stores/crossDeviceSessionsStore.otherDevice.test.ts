import { test, expect, beforeEach } from "vitest";
import { useCrossDeviceSessionsStore, otherDeviceListsSession } from "./crossDeviceSessionsStore";

beforeEach(() => {
  localStorage.clear();
  useCrossDeviceSessionsStore.setState({ manifests: {}, opens: {}, tombstones: {} });
});

test("true when another device's manifest lists the session", () => {
  localStorage.setItem("voltius.device_id", "me");
  useCrossDeviceSessionsStore.setState({
    manifests: {
      other: { deviceId: "other", updatedAt: "2026-01-01", sessions: [{ id: "s1" }] } as never,
    },
  });
  expect(otherDeviceListsSession("s1")).toBe(true);
  expect(otherDeviceListsSession("nope")).toBe(false);
});

test("false when only MY device lists it (self excluded)", () => {
  localStorage.setItem("voltius.device_id", "me");
  useCrossDeviceSessionsStore.setState({
    manifests: { me: { deviceId: "me", updatedAt: "2026-01-01", sessions: [{ id: "s1" }] } as never },
  });
  expect(otherDeviceListsSession("s1")).toBe(false);
});
