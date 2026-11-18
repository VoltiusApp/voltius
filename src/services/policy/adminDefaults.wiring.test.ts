// @vitest-environment jsdom
import { expect, it, vi } from "vitest";

vi.mock("@/lib/invoke", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/services/saveFile", () => ({ notify: vi.fn() }));
vi.mock("@/services/sync", () => ({ scheduleSync: vi.fn() }));
vi.mock("@/stores/policyStore", async (orig) => ({ ...(await orig<object>()), onPolicyLoaded: vi.fn() }));

it("importing the module does not subscribe before the plugin registry has loaded", async () => {
  const { onPolicyLoaded } = await import("@/stores/policyStore");
  await import("./adminDefaults");
  expect(onPolicyLoaded).not.toHaveBeenCalled();
});
