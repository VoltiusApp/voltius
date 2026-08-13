import { expect, test } from "vitest";
import { createHostPluginAPI } from "./runtime";

test("api.team and api.sharing refuse a plugin without the permission", async () => {
  const api = createHostPluginAPI("__test__", []);
  await expect(api.team.list()).rejects.toThrow(/team:read/);
  await expect(api.team.removeMember("t1", "u1")).rejects.toThrow(/team:write/);
  await expect(api.sharing.list()).rejects.toThrow(/sharing:read/);
  await expect(api.sharing.unshare("s1")).rejects.toThrow(/sharing:write/);
});

test("api.team.list is reachable with team:read", async () => {
  const api = createHostPluginAPI("__test__", ["team:read"]);
  await expect(api.team.list()).resolves.toEqual([]);
});
