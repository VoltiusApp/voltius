import { describe, it, expect } from "vitest";
import type { TFunction } from "i18next";
import { formatSince, sessionStatusLine } from "./sessionStatusLine";

const t = ((key: string, vars?: Record<string, unknown>) => (vars ? `${key}:${JSON.stringify(vars)}` : key)) as unknown as TFunction;
const base = { id: "a", connectionId: "c", connectionName: "c", type: "ssh" } as const;

describe("formatSince", () => {
  it("uses minutes, then hours, then days", () => {
    expect(formatSince(42 * 60_000)).toBe("42m");
    expect(formatSince((3 * 60 + 12) * 60_000)).toBe("3h 12m");
    expect(formatSince((2 * 24 + 4) * 3_600_000)).toBe("2d 4h");
    expect(formatSince(10_000)).toBe("0m");
  });
});

describe("sessionStatusLine", () => {
  const P = "layout.titleBar.stack.status.";
  it("describes each state", () => {
    expect(sessionStatusLine({ ...base, status: "connected" } as never, 0, 42 * 60_000, t)).toBe(`${P}connected:{"time":"42m"}`);
    expect(sessionStatusLine({ ...base, status: "connecting" } as never, null, 0, t)).toBe(`${P}connecting`);
    expect(sessionStatusLine({ ...base, status: "connecting", reconnectWait: "offline" } as never, null, 0, t)).toBe(`${P}offline`);
    expect(sessionStatusLine({ ...base, status: "connecting", reconnectWait: "slow" } as never, null, 0, t)).toBe(`${P}reconnecting`);
    expect(sessionStatusLine({ ...base, status: "disconnected" } as never, null, 0, t)).toBe(`${P}disconnected`);
    expect(sessionStatusLine({ ...base, status: "error", errorMessage: "auth failed" } as never, null, 0, t)).toBe(`${P}error:{"message":"auth failed"}`);
  });

  it("says connected without a time when the start is unknown", () => {
    expect(sessionStatusLine({ ...base, status: "connected" } as never, null, 0, t)).toBe(`${P}connected:{"time":"0m"}`);
  });
});
