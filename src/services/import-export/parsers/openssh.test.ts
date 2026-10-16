// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { detectFormat } from "../formats";
import { invoke } from "@/lib/invoke";
import { bundleFromOpenssh, extractOpensshBundle, type OpensshFiles } from "./openssh";
import { parseImport } from "../importers";

vi.mock("@/lib/invoke", () => ({ invoke: vi.fn() }));

describe("detectFormat for OpenSSH", () => {
  it.each([
    "Host web\n  HostName 10.0.0.5\n",
    "# mine\nInclude conf.d/*\n\nHost a\n  User root\n",
    "host a\n  identityfile ~/.ssh/id\n",
  ])("detects %j", (text) => {
    expect(detectFormat(text)).toBe("openssh");
  });

  it.each([
    ["name,host,username\nweb,web.example.com,root", "csv"],
    ["host,user\nweb,root", "csv"],
  ])("leaves %j to %s", (text, format) => {
    expect(detectFormat(text)).toBe(format);
  });
});

const CONFIG = `Host bastion
  HostName bastion.example.com
  Port 2222
  User alex
  IdentityFile ~/.ssh/id_work
Host db
  HostName 10.0.8.30
  User alex
  ProxyJump bastion,ops@edge.example.com:2201
  IdentityFile ~/.ssh/legacy_rsa
Include conf.d/*
Match host gitlab.*
  User git
`;

const FILES: OpensshFiles = {
  config: CONFIG,
  configError: null,
  includes: { "conf.d/*": [{ path: "/h/.ssh/conf.d/gcp", text: "Host gcp\n  HostName 34.1.2.3\n" }] },
  keys: {
    "~/.ssh/id_work": { privateKey: "-----BEGIN OPENSSH PRIVATE KEY-----\nx\n", publicKey: "ssh-ed25519 AAAAWORK alex@pc\n", privateReadable: true },
    "~/.ssh/legacy_rsa": { privateKey: null, publicKey: null, privateReadable: false },
  },
};

describe("bundleFromOpenssh", () => {
  it("builds hosts, keys, references, jump hosts and notices from the desktop read", () => {
    const b = bundleFromOpenssh(CONFIG, FILES);
    expect(b.connections.map(({ _eid, jump_hosts, ...c }) => c)).toEqual([
      { name: "bastion", host: "bastion.example.com", port: 2222, username: "alex", auth_type: "key", connection_type: "ssh", tags: [], _key_eid: "k0" },
      { name: "db", host: "10.0.8.30", port: 22, username: "alex", auth_type: "key", connection_type: "ssh", tags: [], _key_eid: "k1" },
      { name: "gcp", host: "34.1.2.3", port: 22, username: "", auth_type: "password", connection_type: "ssh", tags: [] },
    ]);
    expect(b.connections[1].jump_hosts?.map(({ id, ...j }) => j)).toEqual([
      { host: "bastion.example.com", port: 2222, username: "alex", _connection_eid: b.connections[0]._eid },
      { host: "edge.example.com", port: 2201, username: "ops" },
    ]);
    expect(b.keys).toEqual([{ _eid: "k0", name: "id_work", tags: [], private_key: FILES.keys["~/.ssh/id_work"].privateKey, public_key: "ssh-ed25519 AAAAWORK alex@pc" }]);
    expect(b.keyRefs).toEqual([{ _eid: "k1", name: "legacy_rsa", public_key: "" }]);
    expect(b.notices).toEqual([{ kind: "match", text: "Match host gitlab.*" }]);
    expect(b.identities).toEqual([]);
  });

  it("turns every key into a name reference and reports Includes when pasted", () => {
    const b = bundleFromOpenssh(CONFIG);
    expect(b.keys).toEqual([]);
    expect(b.keyRefs?.map((r) => r.name)).toEqual(["id_work", "legacy_rsa"]);
    expect(b.notices).toContainEqual({ kind: "include", text: "Include conf.d/*" });
  });

  it("carries a passphrase-protected key unchanged", () => {
    const encrypted = "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAACmFlczI1Ni1jdHI\n-----END OPENSSH PRIVATE KEY-----\n";
    const b = bundleFromOpenssh("Host a\n  IdentityFile ~/.ssh/enc\n", { config: "", configError: null, includes: {}, keys: { "~/.ssh/enc": { privateKey: encrypted, publicKey: null, privateReadable: true } } });
    expect(b.keys[0].private_key).toBe(encrypted);
  });

  it("imports a multi-alias Host line once and links jumps through any of its aliases", () => {
    const b = bundleFromOpenssh("Host web web.example.com\n  HostName 10.0.0.5\nHost db\n  ProxyJump web.example.com\n");
    expect(b.connections.map((c) => c.name)).toEqual(["web", "db"]);
    expect(b.connections[1].jump_hosts?.map(({ id, ...j }) => j)).toEqual([
      { host: "10.0.0.5", port: 22, username: "", _connection_eid: b.connections[0]._eid },
    ]);
  });

  it("takes a ProxyCommand hop's address from its stanza without linking it", () => {
    const b = bundleFromOpenssh("Host web\n  HostName 10.0.0.1\n  ProxyJump bastion\nHost bastion\n  HostName 10.1.1.1\n  Port 2222\n  ProxyCommand nc %h %p\n");
    const [hop] = b.connections[0].jump_hosts!;
    expect(hop).toMatchObject({ host: "10.1.1.1", port: 2222 });
    expect(hop).not.toHaveProperty("_connection_eid");
  });

  it("skips ProxyCommand hosts with a notice", () => {
    const bundle = bundleFromOpenssh("Host coder-ws\n  ProxyCommand coder ssh --stdio coder-ws\nHost web\n  HostName 10.0.0.1\n");
    expect(bundle.connections.map((c) => c.name)).toEqual(["web"]);
    expect(bundle.notices).toContainEqual({ kind: "proxyCommand", text: "Host coder-ws" });
  });

  it("only imports private keys and links public-only files by their blob", () => {
    const pub = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMQ op@agent";
    const ppk = "PuTTY-User-Key-File-3: ssh-ed25519\nEncryption: none\n";
    const text = "Host a\n  IdentityFile ~/.ssh/agent.pub\nHost b\n  IdentityFile ~/.ssh/notes\nHost c\n  IdentityFile ~/.ssh/putty\n";
    const b = bundleFromOpenssh(text, { config: text, configError: null, includes: {}, keys: {
      "~/.ssh/agent.pub": { privateKey: null, publicKey: `${pub}\n`, privateReadable: false },
      "~/.ssh/notes": { privateKey: null, publicKey: null, privateReadable: false },
      "~/.ssh/putty": { privateKey: ppk, publicKey: null, privateReadable: true },
    } });
    expect(b.keys).toEqual([{ _eid: "k2", name: "putty", tags: [], private_key: ppk }]);
    expect(b.keyRefs).toEqual([{ _eid: "k0", name: "agent.pub", public_key: pub }, { _eid: "k1", name: "notes", public_key: "" }]);
  });

  it("reads the config without keys first, then only the keys its hosts use", async () => {
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockResolvedValueOnce({ ...FILES, keys: {} }).mockResolvedValueOnce(FILES);
    const b = await extractOpensshBundle();
    expect(vi.mocked(invoke).mock.calls).toEqual([
      ["openssh_config_read", { keyPaths: null, privateKeys: "read" }],
      ["openssh_config_read", { keyPaths: ["~/.ssh/id_work", "~/.ssh/legacy_rsa"], privateKeys: "read" }],
    ]);
    expect(b.connections).toHaveLength(3);
    expect(b.keys.map((k) => k.name)).toEqual(["id_work"]);
  });

  it("fails clearly when there is no config", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ config: null, configError: null, includes: {}, keys: {} });
    await expect(extractOpensshBundle()).rejects.toThrow(/No ~\/\.ssh\/config was found/);
  });

  it("says why a config that exists could not be read", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ config: null, configError: "cannot read /home/u/.ssh/config", includes: {}, keys: {} });
    await expect(extractOpensshBundle()).rejects.toThrow("~/.ssh/config could not be read (cannot read /home/u/.ssh/config).");
  });

  it("is reachable through parseImport", async () => {
    const b = await parseImport("Host web\n  HostName 10.0.0.5\n");
    expect("connections" in b && b.connections[0].host).toBe("10.0.0.5");
  });
});
