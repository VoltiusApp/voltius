import test from "node:test";
import assert from "node:assert/strict";
import { parseQuickConnect } from "../src/services/quickConnect.ts";

test("ssh: bare host defaults user=root port=22", () => {
  assert.deepEqual(parseQuickConnect("root@host"), { kind: "ssh", user: "root", host: "host", port: 22 });
  assert.deepEqual(parseQuickConnect("host:2222"), { kind: "ssh", user: "root", host: "host", port: 2222 });
});

test("ssh: user@host:port", () => {
  assert.deepEqual(parseQuickConnect("alice@example.com:2200"),
    { kind: "ssh", user: "alice", host: "example.com", port: 2200 });
});

test("ssh: ssh prefix is stripped", () => {
  assert.deepEqual(parseQuickConnect("ssh bob@10.0.0.5"),
    { kind: "ssh", user: "bob", host: "10.0.0.5", port: 22 });
});

test("ssh: -p flag wins over :port", () => {
  assert.deepEqual(parseQuickConnect("-p 2222 bob@host:9999"),
    { kind: "ssh", user: "bob", host: "host", port: 2222 });
});

test("ssh: unrelated flags dropped", () => {
  assert.deepEqual(parseQuickConnect("ssh -v -i key bob@host"),
    { kind: "ssh", user: "bob", host: "host", port: 22 });
});

test("serial: keyword, port, and device paths", () => {
  assert.deepEqual(parseQuickConnect("serial"), { kind: "serial" });
  assert.deepEqual(parseQuickConnect("serial /dev/ttyUSB0"), { kind: "serial", port: "/dev/ttyUSB0" });
  assert.deepEqual(parseQuickConnect("/dev/ttyACM0"), { kind: "serial", port: "/dev/ttyACM0" });
  assert.deepEqual(parseQuickConnect("/dev/cu.usbserial-1410"), { kind: "serial", port: "/dev/cu.usbserial-1410" });
  assert.deepEqual(parseQuickConnect("COM3"), { kind: "serial", port: "COM3" });
  assert.deepEqual(parseQuickConnect("com3"), { kind: "serial", port: "com3" });
});

test("local: keyword and optional shell", () => {
  assert.deepEqual(parseQuickConnect("local"), { kind: "local" });
  assert.deepEqual(parseQuickConnect("local bash"), { kind: "local", shell: "bash" });
  assert.deepEqual(parseQuickConnect("local zsh"), { kind: "local", shell: "zsh" });
});

test("ssh: bare hostname via ssh prefix and trimming", () => {
  assert.deepEqual(parseQuickConnect("ssh myserver"), { kind: "ssh", user: "root", host: "myserver", port: 22 });
  assert.deepEqual(parseQuickConnect("  root@host  "), { kind: "ssh", user: "root", host: "host", port: 22 });
});

test("negatives return null", () => {
  for (const s of ["", "   ", "prod", "my-server", "> snippet", "@ settings", "m> mp", "join abc"]) {
    assert.equal(parseQuickConnect(s), null, `expected null for ${JSON.stringify(s)}`);
  }
});
