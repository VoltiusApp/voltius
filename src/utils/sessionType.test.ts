import { describe, it, expect } from "vitest";
import { acceptsTerminalInput, isRunnableSession } from "./sessionType";

describe("acceptsTerminalInput", () => {
  it("is true for terminals and false for multiplayer views and web pages", () => {
    expect(acceptsTerminalInput({ type: "ssh" })).toBe(true);
    expect(acceptsTerminalInput({ type: "local" })).toBe(true);
    expect(acceptsTerminalInput({ type: "serial" })).toBe(true);
    expect(acceptsTerminalInput({ type: "multiplayer" })).toBe(false);
    expect(acceptsTerminalInput({ type: "web" })).toBe(false);
  });
});

describe("isRunnableSession", () => {
  it("needs a connected session that takes terminal input", () => {
    expect(isRunnableSession({ type: "ssh", status: "connected" })).toBe(true);
    expect(isRunnableSession({ type: "ssh", status: "connecting" })).toBe(false);
    expect(isRunnableSession({ type: "web", status: "connected" })).toBe(false);
  });
});
