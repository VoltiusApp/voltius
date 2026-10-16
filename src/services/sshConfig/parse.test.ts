import { describe, expect, it } from "vitest";
import { normalizeIdentityPath, parseSshConfig, type IncludedFile } from "./parse";

const hostsOf = (text: string, include?: (p: string) => IncludedFile[] | null) => parseSshConfig(text, include).hosts;

describe("parseSshConfig", () => {
  it("reads one host per alias with defaults", () => {
    expect(hostsOf("Host web\n  HostName 10.0.0.5\n  User deploy\n")).toEqual([
      { alias: "web", hostname: "10.0.0.5", port: 22, user: "deploy" },
    ]);
  });

  it("uses the alias as host and leaves user empty when missing", () => {
    expect(hostsOf("Host box.example.com\n")).toEqual([{ alias: "box.example.com", hostname: "box.example.com", port: 22 }]);
  });

  it("declares one host per Host line, named after its first alias", () => {
    expect(hostsOf("Host a b c\n  HostName 1.2.3.4\n")).toEqual([{ alias: "a", otherAliases: ["b", "c"], hostname: "1.2.3.4", port: 22 }]);
  });

  it("skips aliases a previous Host line already declared", () => {
    expect(hostsOf("Host a b\nHost b c\nHost a\n").map((h) => [h.alias, h.otherAliases])).toEqual([["a", ["b"]], ["c", undefined]]);
  });

  it("keeps the first value obtained, with Host * at the bottom", () => {
    const [h] = hostsOf("Host web\n  User deploy\nHost *\n  User alex\n  Port 2200\n");
    expect(h).toMatchObject({ user: "deploy", port: 2200 });
  });

  it("keeps the first value obtained, with Host * at the top", () => {
    const [h] = hostsOf("Host *\n  User alex\nHost web\n  User deploy\n  HostName w\n");
    expect(h.user).toBe("alex");
  });

  it("applies pattern blocks to matching aliases and reports them", () => {
    const parsed = parseSshConfig("Host db.corp\n  HostName 10.0.0.9\nHost *.corp !old.corp\n  User admin\n");
    expect(parsed.hosts[0].user).toBe("admin");
    expect(parsed.skipped).toEqual([{ kind: "pattern", text: "Host *.corp !old.corp" }]);
  });

  it("ignores Match blocks and reports them", () => {
    const parsed = parseSshConfig("Host a\n  HostName x\nMatch host a\n  User nope\n");
    expect(parsed.hosts[0].user).toBeUndefined();
    expect(parsed.skipped).toEqual([{ kind: "match", text: "Match host a" }]);
  });

  it("marks hosts that go through ProxyCommand", () => {
    const [a, b] = hostsOf("Host a\n  ProxyCommand coder ssh --stdio a\nHost b\n  ProxyCommand none\n");
    expect(a).toMatchObject({ alias: "a", proxyCommand: true });
    expect(b.proxyCommand).toBeUndefined();
  });

  it("takes ProxyCommand from a matching Host * block", () => {
    expect(hostsOf("Host *\n  ProxyCommand tsh proxy ssh %r@%h:%p\nHost web\n")[0].proxyCommand).toBe(true);
  });

  it("accepts Key=Value, quotes, any case, CRLF and a BOM", () => {
    const text = "\uFEFFHOST web\r\n  hostname=10.0.0.5\r\n  IdentityFile \"~/.ssh/my key\"\r\n  port = 2222\r\n";
    expect(hostsOf(text)).toEqual([{ alias: "web", hostname: "10.0.0.5", port: 2222, identityFile: "~/.ssh/my key" }]);
  });

  it("takes the first word of an unquoted value, and the rest of an unterminated quote, like the Rust reader", () => {
    expect(hostsOf("Host a\n  IdentityFile ~/.ssh/my key\n")[0].identityFile).toBe("~/.ssh/my");
    expect(hostsOf("Host a\n  IdentityFile \"~/.ssh/my key\n")[0].identityFile).toBe("~/.ssh/my key");
  });

  it("keeps the first IdentityFile and resolves relative ones under ~/.ssh", () => {
    expect(hostsOf("Host a\n  IdentityFile id_a\n  IdentityFile id_b\n")[0].identityFile).toBe("~/.ssh/id_a");
  });

  it("imports a host declared twice once, with the first values", () => {
    const hosts = hostsOf("Host a\n  HostName one\nHost a\n  HostName two\n");
    expect(hosts).toHaveLength(1);
    expect(hosts[0].hostname).toBe("one");
  });

  it("expands Include in place and reports unreadable or cyclic ones", () => {
    const files: Record<string, IncludedFile[]> = {
      "conf.d/*": [{ path: "/h/.ssh/conf.d/a", text: "Host inc\n  HostName 9.9.9.9\nInclude loop\n" }, { path: "/h/.ssh/conf.d/b", text: null }],
      loop: [{ path: "/h/.ssh/conf.d/a", text: "Host never\n" }],
    };
    const parsed = parseSshConfig("Host first\n  HostName f\nInclude conf.d/*\nHost last\n  HostName l\n", (p) => files[p] ?? null);
    expect(parsed.hosts.map((h) => h.alias)).toEqual(["first", "inc", "last"]);
    expect(parsed.skipped).toEqual([
      { kind: "include", text: "Include /h/.ssh/conf.d/a" },
      { kind: "include", text: "Include /h/.ssh/conf.d/b" },
    ]);
  });

  it("tells an Include refused outside ~/.ssh from an unreadable one", () => {
    const files: Record<string, IncludedFile[]> = { "~/.orbstack/ssh/config": [{ path: "/h/.orbstack/ssh/config", text: null, refused: true }] };
    const parsed = parseSshConfig("Include ~/.orbstack/ssh/config\nHost a\n", (p) => files[p] ?? null);
    expect(parsed.skipped).toEqual([{ kind: "includeOutside", text: "Include /h/.orbstack/ssh/config" }]);
  });

  it("reports nothing for an Include that matches no file", () => {
    expect(parseSshConfig("Include conf.d/*\nHost a\n", () => []).skipped).toEqual([]);
  });

  it("reports every Include when no resolver is given", () => {
    expect(parseSshConfig("Include conf.d/*\n").skipped).toEqual([{ kind: "include", text: "Include conf.d/*" }]);
  });

  it("stops at depth 16", () => {
    const parsed = parseSshConfig("Include deep\n", () => [{ path: `/p${Math.random()}`, text: "Include deep\n" }]);
    expect(parsed.skipped).toEqual([{ kind: "include", text: "Include deep" }]);
  });

  it("drops ProxyJump none and keeps chains", () => {
    expect(hostsOf("Host a\n  ProxyJump none\nHost b\n  ProxyJump j1,j2\n").map((h) => h.proxyJump)).toEqual([undefined, "j1,j2"]);
  });

  it("falls back to port 22 on an invalid port and expands %h in HostName", () => {
    expect(hostsOf("Host web\n  Port abc\n  HostName %h.example.com\n")[0]).toMatchObject({ port: 22, hostname: "web.example.com" });
  });

  it("reports IdentityFile tokens it cannot resolve, once", () => {
    const parsed = parseSshConfig("Host a\n  IdentityFile ~/.ssh/%r\nHost b\n  IdentityFile ~/.ssh/%r\n");
    expect(parsed.hosts.every((h) => h.identityFile === undefined)).toBe(true);
    expect(parsed.skipped).toEqual([{ kind: "key", text: "~/.ssh/%r" }]);
  });
});

describe("normalizeIdentityPath", () => {
  it.each([
    ["~/.ssh/id", "~/.ssh/id"],
    ["%d/.ssh/id", "~/.ssh/id"],
    ["/abs/id", "/abs/id"],
    ["C:\\keys\\id", "C:\\keys\\id"],
    ["id_rsa", "~/.ssh/id_rsa"],
    ["none", null],
    ["~/.ssh/%u", null],
  ])("%s → %s", (input, expected) => {
    expect(normalizeIdentityPath(input)).toBe(expected);
  });
});
