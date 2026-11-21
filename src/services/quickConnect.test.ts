import { describe, expect, it } from "vitest";
import { buildWebQuickConnectConnection, parseQuickConnect } from "./quickConnect";

describe("parseQuickConnect: web", () => {
  it("reads 'https host:port'", () => {
    expect(parseQuickConnect("https 1.1.1.1:8001")).toEqual({ kind: "web", host: "1.1.1.1", port: 8001, secure: true });
  });

  it("reads a URL and drops its path", () => {
    expect(parseQuickConnect("https://192.168.1.3:8006/#v1:0")).toEqual({ kind: "web", host: "192.168.1.3", port: 8006, secure: true });
  });

  it("defaults the port to the scheme's", () => {
    expect(parseQuickConnect("https example.com")).toMatchObject({ port: 443, secure: true });
    expect(parseQuickConnect("http example.com")).toMatchObject({ port: 80, secure: false });
    expect(parseQuickConnect("HTTP://nas.local:5000")).toEqual({ kind: "web", host: "nas.local", port: 5000, secure: false });
  });

  it("reads a bracketed IPv6 host", () => {
    expect(parseQuickConnect("https [::1]:8443")).toEqual({ kind: "web", host: "::1", port: 8443, secure: true });
  });

  it("is not read as ssh, and ssh is unaffected", () => {
    expect(parseQuickConnect("https 1.1.1.1:8001")?.kind).toBe("web");
    expect(parseQuickConnect("ssh carl@1.1.1.1:2222")).toEqual({ kind: "ssh", user: "carl", host: "1.1.1.1", port: 2222 });
    expect(parseQuickConnect("1.1.1.1:2222")?.kind).toBe("ssh");
  });

  it("ignores an incomplete or invalid address", () => {
    expect(parseQuickConnect("https")).toBeNull();
    expect(parseQuickConnect("https ")).toBeNull();
    expect(parseQuickConnect("https host:99999")?.kind).not.toBe("web");
    expect(parseQuickConnect("https a:b:c")?.kind).not.toBe("web");
  });

  it("builds an unsaved web connection", () => {
    const c = buildWebQuickConnectConnection({ kind: "web", host: "1.1.1.1", port: 8001, secure: true });
    expect(c).toMatchObject({ connection_type: "web", web_secure: true, host: "1.1.1.1", port: 8001, name: "1.1.1.1:8001" });
    expect(buildWebQuickConnectConnection({ kind: "web", host: "h", port: 443, secure: true }).name).toBe("h");
  });
});
