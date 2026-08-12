import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/services/local", () => ({ localSendInput: vi.fn(async () => {}) }));
vi.mock("@/services/serial", () => ({ serialWrite: vi.fn(async () => {}) }));
vi.mock("@/services/ssh", () => ({ sshSendInput: vi.fn(async () => {}) }));

import { sendSessionInput } from "./sessionInput";
import { localSendInput } from "@/services/local";
import { serialWrite } from "@/services/serial";
import { sshSendInput } from "@/services/ssh";

const bytes = new TextEncoder().encode("hi");

describe("sendSessionInput", () => {
  beforeEach(() => vi.clearAllMocks());

  it("routes a local session to local_send_input", async () => {
    await sendSessionInput("s1", "local", bytes);
    expect(localSendInput).toHaveBeenCalledWith("s1", bytes);
    expect(sshSendInput).not.toHaveBeenCalled();
    expect(serialWrite).not.toHaveBeenCalled();
  });

  it("routes a serial session to serial_write", async () => {
    await sendSessionInput("s2", "serial", bytes);
    expect(serialWrite).toHaveBeenCalledWith("s2", bytes);
    expect(sshSendInput).not.toHaveBeenCalled();
  });

  it("routes an ssh session to ssh_send_input", async () => {
    await sendSessionInput("s3", "ssh", bytes);
    expect(sshSendInput).toHaveBeenCalledWith("s3", bytes);
  });

  it("rejects when the transport rejects, rather than swallowing", async () => {
    vi.mocked(sshSendInput).mockRejectedValueOnce(new Error("channel closed"));
    await expect(sendSessionInput("s3", "ssh", bytes)).rejects.toThrow("channel closed");
  });
});
