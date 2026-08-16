import { describe, it, expect, vi, beforeEach } from "vitest";

const unlisten = () => {};
vi.mock("@/services/local", () => ({
  localSendInput: vi.fn(async () => {}),
  localResize: vi.fn(async () => {}),
  onLocalOutput: vi.fn(async () => unlisten),
}));
vi.mock("@/services/serial", () => ({
  serialWrite: vi.fn(async () => {}),
  onSerialOutput: vi.fn(async () => unlisten),
}));
vi.mock("@/services/ssh", () => ({
  sshSendInput: vi.fn(async () => {}),
  sshResize: vi.fn(async () => {}),
  onSshOutput: vi.fn(async () => unlisten),
}));

import { sendSessionInput, sendSessionResize, onSessionOutput } from "./sessionInput";
import { localSendInput, localResize, onLocalOutput } from "@/services/local";
import { serialWrite, onSerialOutput } from "@/services/serial";
import { sshSendInput, sshResize, onSshOutput } from "@/services/ssh";

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

describe("onSessionOutput", () => {
  beforeEach(() => vi.clearAllMocks());
  const cb = () => {};

  it("subscribes a local session to local-output", async () => {
    await onSessionOutput("s1", "local", cb);
    expect(onLocalOutput).toHaveBeenCalledWith("s1", cb);
    expect(onSshOutput).not.toHaveBeenCalled();
  });

  it("subscribes a serial session to serial-output", async () => {
    await onSessionOutput("s2", "serial", cb);
    expect(onSerialOutput).toHaveBeenCalledWith("s2", cb);
    expect(onSshOutput).not.toHaveBeenCalled();
  });

  it("subscribes an ssh session to ssh-output", async () => {
    await onSessionOutput("s3", "ssh", cb);
    expect(onSshOutput).toHaveBeenCalledWith("s3", cb);
  });

  it("subscribes nothing for a multiplayer tab, which has no local transport", async () => {
    const stop = await onSessionOutput("s4", "multiplayer", cb);
    expect(onSshOutput).not.toHaveBeenCalled();
    expect(onLocalOutput).not.toHaveBeenCalled();
    expect(onSerialOutput).not.toHaveBeenCalled();
    expect(() => stop()).not.toThrow();
  });
});

describe("sendSessionResize", () => {
  beforeEach(() => vi.clearAllMocks());

  it("routes a local session to local_resize", async () => {
    await sendSessionResize("s1", "local", 120, 40);
    expect(localResize).toHaveBeenCalledWith("s1", 120, 40);
    expect(sshResize).not.toHaveBeenCalled();
  });

  it("routes an ssh session to ssh_resize", async () => {
    await sendSessionResize("s3", "ssh", 120, 40);
    expect(sshResize).toHaveBeenCalledWith("s3", 120, 40);
    expect(localResize).not.toHaveBeenCalled();
  });

  it("no-ops for serial, which has no window size", async () => {
    await expect(sendSessionResize("s2", "serial", 120, 40)).resolves.toBeUndefined();
    expect(localResize).not.toHaveBeenCalled();
    expect(sshResize).not.toHaveBeenCalled();
  });
});
