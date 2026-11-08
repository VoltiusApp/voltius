import { beforeEach, describe, expect, test, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@/lib/invoke", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));

let local: typeof import("./local");

const bash = { name: "bash", path: "/bin/bash" };
const zsh = { name: "zsh", path: "/bin/zsh" };
const KEY = "appSettings.terminal.preferredShell";

const setPolicy = async (value: unknown) =>
  (await import("@/stores/policyStore")).usePolicyStore.setState({ machine: { policy: value === undefined ? {} : { [KEY]: value }, defaults: {} } });

beforeEach(async () => {
  vi.resetModules();
  local = await import("./local");
  await setPolicy(undefined);
  invoke.mockReset();
  invoke.mockImplementation(async (cmd: string) => (cmd === "local_list_shells" ? [bash, zsh] : undefined));
});

describe("shell policy", () => {
  test("locked shell not installed falls back to system default", async () => {
    invoke.mockImplementation(async () => [bash]);
    await setPolicy("/usr/bin/fish");
    expect(await local.policyShell("/bin/bash")).toBeUndefined();
  });

  test("allowed matches by name", async () => {
    await setPolicy({ $range: { allowed: ["ZSH"] } });
    expect(local.allowedShells([bash, zsh])).toEqual([zsh]);
  });

  test("requested shell outside allowed is replaced", async () => {
    await setPolicy({ $range: { allowed: ["zsh"] } });
    expect(await local.policyShell("/bin/bash")).toBe("/bin/zsh");
  });

  test("requested shell inside allowed is unchanged", async () => {
    await setPolicy({ $range: { allowed: ["zsh", "bash"] } });
    expect(await local.policyShell("/bin/bash")).toBe("/bin/bash");
  });

  test("lock replaces any request", async () => {
    await setPolicy("/bin/zsh");
    expect(await local.policyShell(undefined)).toBe("/bin/zsh");
    expect(await local.policyShell("/bin/zsh")).toBe("/bin/zsh");
  });

  test("no policy leaves the request alone", async () => {
    expect(await local.policyShell("/opt/x")).toBe("/opt/x");
    expect(await local.policyShell(undefined)).toBeUndefined();
  });

  test("localConnect spawns the policy shell", async () => {
    await setPolicy("zsh");
    await local.localConnect("s", 80, 24, "/bin/bash");
    expect(invoke).toHaveBeenCalledWith("local_connect", expect.objectContaining({ shell: "/bin/zsh" }));
  });

  test("detection is memoized", async () => {
    await local.listLocalShells();
    await local.listLocalShells();
    expect(invoke.mock.calls.filter(([c]) => c === "local_list_shells").length).toBe(1);
  });

  test("a rejected detection is not memoized", async () => {
    invoke.mockImplementationOnce(async () => {
      throw new Error("boom");
    });
    await expect(local.listLocalShells()).rejects.toThrow("boom");
    expect(await local.listLocalShells()).toEqual([bash, zsh]);
  });

  test("refresh refetches, concurrent calls share one fetch", async () => {
    await local.listLocalShells();
    const [a, b] = [local.listLocalShells(true), local.listLocalShells(true)];
    await Promise.all([a, b]);
    expect(invoke.mock.calls.filter(([c]) => c === "local_list_shells").length).toBe(2);
  });
});
