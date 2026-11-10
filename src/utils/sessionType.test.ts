import { describe, it, expect } from "vitest";
import { acceptsTerminalInput } from "./sessionType";

describe("acceptsTerminalInput", () => {
  it("is true for terminals and false for multiplayer views and web pages", () => {
    expect(acceptsTerminalInput({ type: "ssh" })).toBe(true);
    expect(acceptsTerminalInput({ type: "local" })).toBe(true);
    expect(acceptsTerminalInput({ type: "serial" })).toBe(true);
    expect(acceptsTerminalInput({ type: "multiplayer" })).toBe(false);
    expect(acceptsTerminalInput({ type: "web" })).toBe(false);
  });
});
