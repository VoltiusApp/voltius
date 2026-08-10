import { describe, expect, it, vi, beforeEach } from "vitest";
import { addKeyToHost, DEFAULT_EXPORT_SCRIPT } from "./keyExport";

const getSecret = vi.fn(async (..._a: unknown[]) => "ssh-ed25519 AAAA... user@host\n");
const sshExecCommand = vi.fn(async (..._a: unknown[]) => ({ stdout: "", stderr: "", exit_code: 0 }));
const resolveConnectionCredentials = vi.fn(async (..._a: unknown[]) => ({
  username: "root", password: undefined, privateKey: "pk", passphrase: undefined,
}));

vi.mock("@/services/vault", () => ({ getSecret: (...a: unknown[]) => getSecret(...a) }));
vi.mock("@/services/ssh", () => ({ sshExecCommand: (...a: unknown[]) => sshExecCommand(...a) }));
vi.mock("@/services/credentials", () => ({
  resolveConnectionCredentials: (...a: unknown[]) => resolveConnectionCredentials(...a),
}));

const sshKey = { id: "k1", name: "laptop" } as any;
const connection = { id: "c1", host: "example.test", port: 22 } as any;

beforeEach(() => vi.clearAllMocks());

describe("addKeyToHost", () => {
  it("reads the key's public half, not its private one", async () => {
    await addKeyToHost({ sshKey, connection });
    expect(getSecret).toHaveBeenCalledWith("key:k1:public");
    expect(getSecret).not.toHaveBeenCalledWith("key:k1:private");
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

  it("throws when the public key is missing", async () => {
    getSecret.mockResolvedValueOnce("" as never);
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
});
