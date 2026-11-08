import { test, expect } from "vitest";
import { parseQuickConnect, buildQuickConnectConnection } from "../src/services/quickConnect.ts";

test("ssh: bare host defaults user=root port=22", () => {
  expect(parseQuickConnect("root@host")).toEqual({ kind: "ssh", user: "root", host: "host", port: 22 });
  expect(parseQuickConnect("host:2222")).toEqual({ kind: "ssh", user: "root", host: "host", port: 2222 });
});

test("ssh: user@host:port", () => {
  expect(parseQuickConnect("alice@example.com:2200")).toEqual({ kind: "ssh", user: "alice", host: "example.com", port: 2200 });
});

test("ssh: ssh prefix is stripped", () => {
  expect(parseQuickConnect("ssh bob@10.0.0.5")).toEqual({ kind: "ssh", user: "bob", host: "10.0.0.5", port: 22 });
});

test("ssh: -p flag wins over :port", () => {
  expect(parseQuickConnect("-p 2222 bob@host:9999")).toEqual({ kind: "ssh", user: "bob", host: "host", port: 2222 });
});

test("ssh: unrelated flags dropped", () => {
  expect(parseQuickConnect("ssh -v -i key bob@host")).toEqual({ kind: "ssh", user: "bob", host: "host", port: 22 });
});

test("serial: keyword, port, and device paths", () => {
  expect(parseQuickConnect("serial")).toEqual({ kind: "serial" });
  expect(parseQuickConnect("serial /dev/ttyUSB0")).toEqual({ kind: "serial", port: "/dev/ttyUSB0" });
  expect(parseQuickConnect("/dev/ttyACM0")).toEqual({ kind: "serial", port: "/dev/ttyACM0" });
  expect(parseQuickConnect("/dev/cu.usbserial-1410")).toEqual({ kind: "serial", port: "/dev/cu.usbserial-1410" });
  expect(parseQuickConnect("COM3")).toEqual({ kind: "serial", port: "COM3" });
  expect(parseQuickConnect("com3")).toEqual({ kind: "serial", port: "com3" });
});

test("local: keyword and optional shell", () => {
  expect(parseQuickConnect("local")).toEqual({ kind: "local" });
  expect(parseQuickConnect("local bash")).toEqual({ kind: "local", shell: "bash" });
  expect(parseQuickConnect("local zsh")).toEqual({ kind: "local", shell: "zsh" });
});

test("ssh: bare hostname via ssh prefix and trimming", () => {
  expect(parseQuickConnect("ssh myserver")).toEqual({ kind: "ssh", user: "root", host: "myserver", port: 22 });
  expect(parseQuickConnect("  root@host  ")).toEqual({ kind: "ssh", user: "root", host: "host", port: 22 });
});

test("negatives return null", () => {
  for (const s of ["", "   ", "prod", "my-server", "> snippet", "@ settings", "m> mp", "join abc"]) {
    expect(parseQuickConnect(s), `expected null for ${JSON.stringify(s)}`).toBe(null);
  }
});

test("buildQuickConnectConnection: maps ssh intent to an ephemeral personal connection", () => {
  const c = buildQuickConnectConnection({ kind: "ssh", user: "alice", host: "10.0.0.5", port: 2222 });
  expect(c.name).toBe("alice@10.0.0.5");
  expect(c.host).toBe("10.0.0.5");
  expect(c.port).toBe(2222);
  expect(c.username).toBe("alice");
  expect(c.auth_type).toBe("password");
  expect(c.vault_id).toBe("personal");
  expect(c.tags).toEqual([]);
  expect(c.last_used_at).toBe(null);
  expect(typeof c.id).toBe("string");
  expect(c.id.length > 0).toBeTruthy();
});

test("ssh: IPv6 literals, bare and bracketed (#787)", () => {
  const v6 = (port: number) => ({ kind: "ssh", user: "admin", host: "2001:db8::10", port });
  expect(parseQuickConnect("ssh admin@2001:db8::10")).toEqual(v6(22));
  expect(parseQuickConnect("ssh admin@[2001:db8::10]")).toEqual(v6(22));
  expect(parseQuickConnect("ssh -p 2222 admin@2001:db8::10")).toEqual(v6(2222));
  expect(parseQuickConnect("ssh admin@[2001:db8::10]:2222")).toEqual(v6(2222));
  expect(parseQuickConnect("admin@[2001:db8::10]:2222")).toEqual(v6(2222));
  expect(parseQuickConnect("ssh ::1")).toEqual({ kind: "ssh", user: "root", host: "::1", port: 22 });
  expect(parseQuickConnect("ssh [fe80::1%eth0]:22")).toEqual({ kind: "ssh", user: "root", host: "fe80::1%eth0", port: 22 });
});

test("ssh: IPv4 and DNS forms are unchanged by IPv6 support", () => {
  expect(parseQuickConnect("ssh admin@192.0.2.1:2222")).toEqual({ kind: "ssh", user: "admin", host: "192.0.2.1", port: 2222 });
  expect(parseQuickConnect("ssh admin@db.example.com")).toEqual({ kind: "ssh", user: "admin", host: "db.example.com", port: 22 });
});

test("ssh: malformed brackets are not a target", () => {
  for (const s of ["ssh admin@[2001:db8::10", "ssh admin@[]", "ssh admin@[2001:db8::10]x"]) {
    expect(parseQuickConnect(s), s).toBe(null);
  }
});

test("ssh: ports 1 and 65535 are accepted (#788)", () => {
  expect(parseQuickConnect("ssh admin@host:1")).toMatchObject({ kind: "ssh", port: 1 });
  expect(parseQuickConnect("ssh -p 65535 admin@host")).toMatchObject({ kind: "ssh", port: 65535 });
});

test("ssh: an explicit invalid port is reported, never replaced by 22 (#788)", () => {
  const cases: [string, string][] = [
    ["ssh admin@host:22abc", "22abc"],
    ["ssh admin@host:abc", "abc"],
    ["ssh admin@host:", ""],
    ["ssh admin@host:0", "0"],
    ["ssh admin@host:65536", "65536"],
    ["ssh -p 22x admin@host", "22x"],
    ["ssh -p 70000 admin@host", "70000"],
    ["ssh -p -1 admin@host", "-1"],
    ["ssh -p 0 admin@host", "0"],
    ["ssh admin@[2001:db8::10]:99999", "99999"],
    ["host:22abc", "22abc"],
    ["-p 2222 bob@host:9999x", "9999x"],
  ];
  for (const [input, port] of cases) {
    expect(parseQuickConnect(input), input).toEqual({ kind: "invalid-port", port });
  }
});

test("ssh: a trailing -p with no value is an invalid port", () => {
  expect(parseQuickConnect("ssh admin@host -p")).toEqual({ kind: "invalid-port", port: "" });
});
