import { describe, expect, it } from "vitest";
import { detectFormat } from "../formats";
import { bundleFromPutty } from "./putty";

const SERIAL_DEFAULTS = { SerialLine: "/dev/ttyS0", SerialSpeed: 9600, SerialDataBits: 8, SerialStopHalfbits: 2, SerialParity: 0, SerialFlowControl: 1 };
const NO_PROXY = { ProxyMethod: 0, ProxyHost: "proxy", ProxyPort: 80, ProxyUsername: "", ProxyPassword: "" };

// Trimmed from `tail -n +1 ~/.putty/sessions/*` after saving these sessions in PuTTY 0.78's own dialog.
const unixSessions: [string, Record<string, string | number>][] = [
  ["Caf%C3%A9%20%2F%20lab", { HostName: "root@2001:db8::5", Protocol: "ssh", PortNumber: 22, ...NO_PROXY, UserName: "", AgentFwd: 0, PublicKeyFile: "", PortForwardings: "", ...SERIAL_DEFAULTS }],
  ["Lab%20console", {
    HostName: "web.example.com", Protocol: "serial", PortNumber: 0, ProxyMethod: 2, ProxyHost: "socks.example.com", UserName: "admin",
    SerialLine: "/dev/ttyUSB0", SerialSpeed: 115200, SerialDataBits: 7, SerialStopHalfbits: 4, SerialParity: 2, SerialFlowControl: 2,
  }],
  ["Old%20switch", { HostName: "10.0.0.2", Protocol: "telnet", PortNumber: 23, ...NO_PROXY, ...SERIAL_DEFAULTS }],
  ["Prod%20API", { HostName: "deploy@api.example.com", Protocol: "ssh", PortNumber: 2222, ...NO_PROXY, UserName: "", ...SERIAL_DEFAULTS }],
  ["Web%20%28proxied%29", {
    HostName: "web.example.com", Protocol: "ssh", PortNumber: 22, ProxyMethod: 2, ProxyHost: "socks.example.com", ProxyPort: 1080,
    ProxyUsername: "proxyuser", ProxyPassword: "", UserName: "admin", AgentFwd: 1, PublicKeyFile: "/home/u/.ssh/web.ppk",
    PortForwardings: "D1081=,L8080=localhost:80,R9000=127.0.0.1:9000", ...SERIAL_DEFAULTS,
  }],
  ["v6%20bracketed", { HostName: "[fe80::1]:2200", Protocol: "ssh", PortNumber: 22, ...NO_PROXY, ...SERIAL_DEFAULTS }],
];

const sessionFile = (fields: Record<string, string | number>) => ["Present=1", ...Object.entries(fields).map(([k, v]) => `${k}=${v}`)].join("\n");
const tailOutput = unixSessions.map(([file, fields]) => `==> ${file} <==\n${sessionFile(fields)}\n`).join("\n");

const ssh = (fields: object) => ({ port: 22, username: "", auth_type: "password", tags: [], connection_type: "ssh", ...fields });

describe("bundleFromPutty", () => {
  it("is detected from a session file and from tail output", () => {
    expect(detectFormat(tailOutput)).toBe("putty");
    expect(detectFormat(sessionFile(unixSessions[3][1]))).toBe("putty");
  });

  it("imports SSH and serial sessions and skips telnet", () => {
    const { connections } = bundleFromPutty(tailOutput);
    expect(connections.map(({ _eid, ...c }) => c)).toEqual([
      ssh({ name: "Café / lab", host: "2001:db8::5", username: "root" }),
      {
        name: "Lab console", tags: [], connection_type: "serial", serial_port: "/dev/ttyUSB0", serial_baud: 115200,
        serial_data_bits: 7, serial_parity: "even", serial_stop_bits: 2, serial_flow_control: "rts-cts",
      },
      ssh({ name: "Prod API", host: "api.example.com", port: 2222, username: "deploy" }),
      ssh({
        name: "Web (proxied)", host: "web.example.com", username: "admin", auth_type: "key", agent_forwarding: true,
        proxy: { mode: "socks5", host: "socks.example.com", port: 1080, username: "proxyuser" },
      }),
      ssh({ name: "v6 bracketed", host: "fe80::1" }),
    ]);
  });

  it("turns tunnels into port forwarding rules for their session", () => {
    const { connections, portForwardingRules } = bundleFromPutty(tailOutput);
    const web = connections.find((c) => c.name === "Web (proxied)")!._eid!;
    expect(portForwardingRules).toEqual([
      { name: "Web (proxied) D1081", tunnel_type: "dynamic", local_port: 1081, remote_port: 0, remote_host: "", target_host: "", bind_host: "127.0.0.1", _connection_eids: [web] },
      { name: "Web (proxied) L8080", tunnel_type: "local", local_port: 8080, remote_port: 80, remote_host: "localhost", target_host: "localhost", bind_host: "127.0.0.1", _connection_eids: [web] },
      { name: "Web (proxied) R9000", tunnel_type: "remote", remote_port: 9000, local_port: 9000, remote_host: "127.0.0.1", target_host: "127.0.0.1", bind_host: "127.0.0.1", _connection_eids: [web] },
    ]);
  });

  it("reads a single session file, which carries no name", () => {
    expect(bundleFromPutty(sessionFile(unixSessions[3][1])).connections).toEqual([
      ssh({ _eid: "pc0", name: undefined, host: "api.example.com", port: 2222, username: "deploy" }),
    ]);
  });

  it("links an SSH proxy to the saved session it names, as PuTTY does", () => {
    const text = [
      "==> bastion <==", sessionFile({ HostName: "bastion.example.com", PortNumber: 2200, UserName: "jump", Protocol: "ssh" }),
      "==> inner <==", sessionFile({ HostName: "10.1.0.5", Protocol: "ssh", ProxyMethod: 6, ProxyHost: "bastion", ProxyPort: 22, ProxyUsername: "" }),
      "==> other <==", sessionFile({ HostName: "10.1.0.6", Protocol: "ssh", ProxyMethod: 6, ProxyHost: "ops@gw.example.com", ProxyPort: 2022 }),
    ].join("\n");
    const [bastion, inner, other] = bundleFromPutty(text).connections;
    expect(inner.jump_hosts).toEqual([{ id: expect.any(String), host: "bastion.example.com", port: 2200, username: "jump", _connection_eid: bastion._eid }]);
    expect(other.jump_hosts).toEqual([{ id: expect.any(String), host: "gw.example.com", port: 2022, username: "ops" }]);
  });

  it("reads escaped environment variables, a proxy password and the pre-ProxyMethod proxy keys", () => {
    const [c] = bundleFromPutty(sessionFile({
      HostName: "h", Environment: "LANG=C.UTF-8,LIST=a\\,b\\=c", ProxyType: 1, ProxyHost: "web-proxy", ProxyPort: 3128, ProxyPassword: "s3cret",
    })).connections;
    expect(c.env_vars).toEqual([
      { id: expect.any(String), key: "LANG", value: "C.UTF-8" },
      { id: expect.any(String), key: "LIST", value: "a,b=c" },
    ]);
    expect(c.proxy).toEqual({ mode: "http", host: "web-proxy", port: 3128 });
    expect(c.proxy_password).toBe("s3cret");
  });

  it("files KiTTY sessions under their folder, leaving Default ones at the root", () => {
    const reg = [
      "Windows Registry Editor Version 5.00",
      "",
      "[HKEY_CURRENT_USER\\Software\\9bis.com\\KiTTY\\Sessions\\db]",
      '"HostName"="db.example.com"',
      '"Folder"="Databases"',
      "",
      "[HKEY_CURRENT_USER\\Software\\9bis.com\\KiTTY\\Sessions\\misc]",
      '"HostName"="misc.example.com"',
      '"Folder"="Default"',
    ].join("\r\n");
    const { folders, connections } = bundleFromPutty(reg);
    expect(folders).toEqual([{ _eid: "pf0", name: "Databases", object_type: "connection" }]);
    expect(connections.map((c) => [c.name, c._folder_eid])).toEqual([["db", "pf0"], ["misc", undefined]]);
  });
});

