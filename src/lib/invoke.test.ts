import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: h.invoke }));

import { invoke } from "./invoke";
import { BackendError } from "@/services/backendErrors";

beforeEach(() => {
  h.invoke.mockReset();
});

describe("invoke", () => {
  it("rejects a coded error as a BackendError whose String() is the message", async () => {
    h.invoke.mockRejectedValue({ code: "port-in-use", message: "Port 80 already in use", params: { port: "80" } });
    const err = await invoke("pf_tunnel_open").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BackendError);
    expect(err).toMatchObject({ code: "port-in-use", params: { port: "80" } });
    expect(String(err)).toBe("Port 80 already in use");
  });

  it("passes a bare string rejection through untouched", async () => {
    h.invoke.mockRejectedValue("Transfer cancelled");
    await expect(invoke("sftp_upload")).rejects.toBe("Transfer cancelled");
  });

  it("resolves with the command's value", async () => {
    h.invoke.mockResolvedValue(42);
    await expect(invoke("x", { a: 1 })).resolves.toBe(42);
    expect(h.invoke).toHaveBeenCalledWith("x", { a: 1 });
  });
});

// A command reached around the wrapper would hand its caller a plain object,
// which prints as "[object Object]".
describe("layering", () => {
  it("only src/lib/invoke.ts imports @tauri-apps/api/core", () => {
    const sources = import.meta.glob(["../**/*.{ts,tsx}", "!../**/*.{test,spec}.{ts,tsx}"], {
      eager: true,
      query: "?raw",
      import: "default",
    }) as Record<string, string>;
    const offenders = Object.entries(sources)
      .filter(([path, text]) => path !== "./invoke.ts" && /["']@tauri-apps\/api\/core["']/.test(text))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });
});
