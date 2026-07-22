import { test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  getServerUrl: vi.fn(),
  fetchWithAuth: vi.fn(),
}));
vi.mock("@/services/sync", () => ({
  getServerUrl: h.getServerUrl,
  fetchWithAuth: h.fetchWithAuth,
}));

import { notifyConnectionUsage, fetchCurrentConnectionUsage } from "./connectionPresence";

beforeEach(() => {
  h.getServerUrl.mockReset().mockResolvedValue("https://srv");
  h.fetchWithAuth.mockReset();
});

test("notifyConnectionUsage: no server URL → does not call fetchWithAuth", async () => {
  h.getServerUrl.mockResolvedValue(null);
  await notifyConnectionUsage("c1", true);
  expect(h.fetchWithAuth).not.toHaveBeenCalled();
});

test("notifyConnectionUsage: posts correct url, method, headers, body (inUse=true)", async () => {
  h.fetchWithAuth.mockResolvedValue({} as Response);
  await notifyConnectionUsage("c1", true);
  expect(h.fetchWithAuth).toHaveBeenCalledTimes(1);
  const [url, init] = h.fetchWithAuth.mock.calls[0];
  expect(url).toBe("https://srv/v1/presence/connection-usage");
  expect(init.method).toBe("POST");
  expect(init.headers["Content-Type"]).toBe("application/json");
  expect(JSON.parse(init.body)).toEqual({ connection_id: "c1", in_use: true });
});

test("notifyConnectionUsage: in_use=false serialized correctly", async () => {
  h.fetchWithAuth.mockResolvedValue({} as Response);
  await notifyConnectionUsage("c1", false);
  const [, init] = h.fetchWithAuth.mock.calls[0];
  expect(JSON.parse(init.body)).toEqual({ connection_id: "c1", in_use: false });
});

test("notifyConnectionUsage: fetch rejection is swallowed", async () => {
  h.fetchWithAuth.mockRejectedValue(new Error("net"));
  await expect(notifyConnectionUsage("c1", true)).resolves.toBeUndefined();
});

test("fetchCurrentConnectionUsage: no server URL → []", async () => {
  h.getServerUrl.mockResolvedValue(null);
  expect(await fetchCurrentConnectionUsage()).toEqual([]);
  expect(h.fetchWithAuth).not.toHaveBeenCalled();
});

test("fetchCurrentConnectionUsage: ok → parsed array; GET method", async () => {
  const entries = [{ connection_id: "c1", user_ids: ["u1"] }];
  h.fetchWithAuth.mockResolvedValue({ ok: true, json: async () => entries } as unknown as Response);
  const result = await fetchCurrentConnectionUsage();
  expect(result).toEqual(entries);
  const [url, init] = h.fetchWithAuth.mock.calls[0];
  expect(init.method).toBe("GET");
  expect(url).toBe("https://srv/v1/presence/connection-usage");
});

test("fetchCurrentConnectionUsage: non-ok → []", async () => {
  h.fetchWithAuth.mockResolvedValue({
    ok: false,
    json: async () => [{ connection_id: "x", user_ids: [] }],
  } as unknown as Response);
  expect(await fetchCurrentConnectionUsage()).toEqual([]);
});

test("fetchCurrentConnectionUsage: fetch throws → []", async () => {
  h.fetchWithAuth.mockRejectedValue(new Error("net"));
  expect(await fetchCurrentConnectionUsage()).toEqual([]);
});

test("fetchCurrentConnectionUsage: json() throws → []", async () => {
  h.fetchWithAuth.mockResolvedValue({
    ok: true,
    json: async () => {
      throw new Error("bad");
    },
  } as unknown as Response);
  expect(await fetchCurrentConnectionUsage()).toEqual([]);
});
