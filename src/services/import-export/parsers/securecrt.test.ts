import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@/lib/invoke";
import { detectFormat, isLocked } from "../formats";
import type { ExportBundle, ImportOutcome, LockedImport } from "../formats";
import { bundleFromSecureCrt, extractSecureCrtBundle, parseSecureCrt } from "./securecrt";
import exportXml from "./__fixtures__/securecrt-export.xml?raw";

vi.mock("@/lib/invoke", () => ({ invoke: vi.fn() }));

// Values SecureCRT 9.7.3 wrote; the export is trimmed to the options the importer reads.
const WEB = "03:2ec07f83619929d066a4dafe4792987355f5805ca7fd0ffda2588d2e99830eb1dddf6b24e3f25310a1706f08fed317631a7c87d1ceecf2ed59684f7e4548a92dce0439fe23722d599c287c7a3ebf2f2f";
const HAND = "02:3cbfeadc5e36e1f715f4ddcb9ee903f50ca059f8801a54f17207b1f4cd579ae9b00777e2f168cbb39d7314856411c53db5fe5b117566800e8f30395b1c5d17a3";
const VERIFIER = "03:2ec07f83619929d066a4dafe47929873313fa32fec78d14cf727ea7811407a1d7d5bdcc41401e6d929c29807616385b2ccef866ab6e6e4e121e60a7bc4d86c02";

const sessionIni = [
  "\uFEFFS:\"Identity Filename V2\"=${VDS_SSH_DATA_PATH}/id_ed25519",
  "D:\"Session Password Saved\"=00000001",
  "S:\"Username\"=deploy",
  `S:"Password V2"=${WEB}`,
  "B:\"Linux Normal Font v2\"=000000a0",
  " f0 ff ff ff 00 00 00 00 00 00 00 00 00 00 00 00 90 01 00 00 00 00 00 01 00 00 00 01 44 00 00 00",
  "S:\"Protocol Name\"=SSH2",
  "D:\"[SSH2] Port\"=000008ae",
  "D:\"Use Global Public Key\"=00000001",
  "Z:\"Description\"=00000002",
  " primary api",
  " second line",
  "D:\"Linux Printer Baud Rate\"=00009600",
  "S:\"Hostname\"=api.example.com",
].join("\n");

const decrypted: Record<string, Record<string, string>> = { "": { [WEB]: "Hunter2-é€", [HAND]: "voltius" } };

function mockDecrypt(expectedPassphrase: string) {
  vi.mocked(invoke).mockImplementation(async (cmd, args) => {
    if (cmd !== "securecrt_decrypt") throw new Error(cmd);
    const { values, passphrase } = args as { values: string[]; passphrase: string };
    const ok = passphrase === expectedPassphrase;
    return { passphrase_ok: ok, values: values.map((v) => (ok ? decrypted[""][v] ?? null : null)) };
  });
}

const byName = (b: ExportBundle, name: string) => b.connections.find((c) => c.name === name);

beforeEach(() => {
  vi.mocked(invoke).mockReset();
});

describe("SecureCRT import", () => {
  it("detects session files and Export Settings XML", () => {
    expect(detectFormat(sessionIni)).toBe("securecrt");
    expect(detectFormat(exportXml)).toBe("securecrt");
    expect(detectFormat("name,host,username\nweb,web.example.com,root")).toBe("csv");
  });

  it("imports SSH and serial sessions from an export, skipping templates and other protocols", () => {
    const { bundle } = parseSecureCrt(exportXml);
    expect(bundle.connections.map((c) => c.name)).toEqual(["console", "api-ü", "inner", "web", "deep.example.com", "hand-02", "jump", "v6"]);
    expect(byName(bundle, "console")).toEqual({
      name: "console", tags: [], connection_type: "serial", serial_port: "/dev/ttyUSB0", serial_baud: 57600,
      serial_data_bits: 7, serial_parity: "even", serial_stop_bits: 2, serial_flow_control: "rts-cts",
      _eid: "sc0", _folder_eid: "sf0",
    });
    expect(byName(bundle, "api-ü")).toEqual({
      name: "api-ü", host: "api.example.com", port: 2222, username: "deploy", auth_type: "key", tags: [],
      connection_type: "ssh", _key_eid: "sk0", notes: "primary api\nsecond line", _eid: "sc1", _folder_eid: "sf2",
    });
    expect(byName(bundle, "v6")).toMatchObject({ host: "2001:db8::1", connection_type: "ssh", auth_type: "password" });
  });

  it("rebuilds the folder tree and drops folders left empty", () => {
    const { bundle } = parseSecureCrt(exportXml);
    expect(bundle.folders).toEqual([
      { _eid: "sf0", name: "Lab", object_type: "connection" },
      { _eid: "sf1", name: "Prod", object_type: "connection" },
      { _eid: "sf2", name: "Bäckend", object_type: "connection", parent_folder_eid: "sf1" },
    ]);
  });

  it("takes the session key from the export's embedded files", () => {
    const { bundle } = parseSecureCrt(exportXml);
    expect(bundle.keys).toEqual([{
      _eid: "sk0", name: "id_ed25519", tags: [],
      private_key: "-----BEGIN OPENSSH PRIVATE KEY-----\nAAAA\n-----END OPENSSH PRIVATE KEY-----\n",
    }]);
  });

  it("links jump hosts named by session path or bare name", () => {
    const { bundle } = parseSecureCrt(exportXml);
    const jumpEid = byName(bundle, "jump")?._eid;
    const webEid = byName(bundle, "web")?._eid;
    expect(byName(bundle, "inner")?.jump_hosts).toEqual([
      { id: expect.any(String), host: "bastion.example.com", port: 22, username: "jumper", _connection_eid: jumpEid },
    ]);
    expect(byName(bundle, "deep.example.com")?.jump_hosts?.[0]).toMatchObject({ host: "web.example.com", _connection_eid: webEid });
  });

  it("decrypts saved passwords when there is no config passphrase", async () => {
    mockDecrypt("");
    const outcome = await bundleFromSecureCrt(exportXml);
    expect(isLocked(outcome)).toBe(false);
    const bundle = outcome as ExportBundle;
    expect(byName(bundle, "web")?.password).toBe("Hunter2-é€");
    expect(byName(bundle, "hand-02")?.password).toBe("voltius");
    expect(byName(bundle, "jump")?.password).toBeUndefined();
    expect(invoke).toHaveBeenCalledWith("securecrt_decrypt", { values: [WEB, HAND], verifier: VERIFIER, passphrase: "" });
  });

  describe("with a config passphrase", () => {
    let locked: LockedImport;
    beforeEach(async () => {
      mockDecrypt("Pa55-ßeta");
      const outcome: ImportOutcome = await bundleFromSecureCrt(exportXml);
      expect(isLocked(outcome)).toBe(true);
      locked = outcome as LockedImport;
    });

    it("asks for it, and rejects a wrong one", async () => {
      expect(locked.kind).toBe("securecrt");
      await expect(locked.unlock("nope")).rejects.toThrow();
    });

    it("imports the passwords once it is given", async () => {
      expect(byName(await locked.unlock("Pa55-ßeta"), "web")?.password).toBe("Hunter2-é€");
    });

    it("can import the sessions without their passwords", () => {
      const bundle = locked.withoutSecrets?.();
      expect(bundle?.connections).toHaveLength(8);
      expect(bundle?.connections.some((c) => c.password)).toBe(false);
    });
  });

  it("names a lone session file after its host and reads hex DWORDs and multi-line values", async () => {
    mockDecrypt("");
    const bundle = (await bundleFromSecureCrt(sessionIni)) as ExportBundle;
    expect(bundle.folders).toEqual([]);
    expect(bundle.connections).toEqual([{
      name: "api.example.com", host: "api.example.com", port: 2222, username: "deploy", auth_type: "password", tags: [],
      connection_type: "ssh", notes: "primary api\nsecond line", password: "Hunter2-é€", _eid: "sc0",
    }]);
  });

  it("reads a local config folder, using the global key for sessions that ask for it", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      sessions: [
        { path: "Default", text: "S:\"Protocol Name\"=SSH2\nS:\"Hostname\"=\n" },
        { path: "Prod/web", text: "S:\"Protocol Name\"=SSH2\nS:\"Hostname\"=web\nD:\"Use Global Public Key\"=00000001\n" },
      ],
      global: "S:\"Config Passphrase\"=\n",
      ssh2: "S:\"Identity Filename V2\"=${VDS_CONFIG_PATH}/Keys/id_rsa\n",
      files: [{ path: "${VDS_CONFIG_PATH}/Keys/id_rsa", text: "-----BEGIN RSA PRIVATE KEY-----\n" }],
    });
    const bundle = (await extractSecureCrtBundle("/cfg")) as ExportBundle;
    expect(invoke).toHaveBeenCalledWith("securecrt_read_config", { dir: "/cfg" });
    expect(bundle.connections).toEqual([expect.objectContaining({ name: "web", auth_type: "key", _key_eid: "sk0", _folder_eid: "sf0" })]);
    expect(bundle.keys.map((k) => k.name)).toEqual(["id_rsa"]);
  });
});
