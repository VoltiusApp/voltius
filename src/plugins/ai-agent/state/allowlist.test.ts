import { describe, it, expect } from "vitest";
import {
  allowlistCandidates,
  entriesEqual,
  isWellFormedEntry,
  normalizeCommand,
  PREFIX_GRANTABLE_BINARIES,
  type AllowlistEntry,
} from "./allowlist";

const H = "ssh-host-1";

describe("normalizeCommand", () => {
  it("trims the ends", () => {
    expect(normalizeCommand("  df -h  ")).toBe("df -h");
  });

  // Collapsing internal runs would make `grep 'a  b' f` match a grant given for
  // `grep 'a b' f` — a genuinely different command, because the arg is quoted.
  it("preserves internal whitespace", () => {
    expect(normalizeCommand("grep 'a  b' f")).toBe("grep 'a  b' f");
  });
});

describe("allowlistCandidates — non-command tools", () => {
  it("yields a single tool-grain candidate", () => {
    expect(allowlistCandidates("open_session", { connectionId: "c1" }, H)).toEqual([
      { host: H, tool: "open_session", grain: "tool", key: "open_session" },
    ]);
  });
});

describe("allowlistCandidates — run_command", () => {
  it("yields exact only for a binary that is not prefix-grantable", () => {
    expect(allowlistCandidates("run_command", { command: "cat /etc/passwd" }, H)).toEqual([
      { host: H, tool: "run_command", grain: "exact", key: "cat /etc/passwd" },
    ]);
  });

  it("yields exact AND prefix for a positive-list binary", () => {
    expect(allowlistCandidates("run_command", { command: "df -h" }, H)).toEqual([
      { host: H, tool: "run_command", grain: "exact", key: "df -h" },
      { host: H, tool: "run_command", grain: "prefix", key: "df" },
    ]);
  });

  it("never offers prefix for an unknown binary (fails closed)", () => {
    const grains = allowlistCandidates("run_command", { command: "mybin --x" }, H).map((c) => c.grain);
    expect(grains).toEqual(["exact"]);
  });

  it.each(["sudo -l", "ssh other-host uptime", "find / -name x", "env", "xargs echo", "python -c 1", "docker ps", "journalctl -u ssh"])(
    "never offers prefix for exec-capable %s",
    (command) => {
      const grains = allowlistCandidates("run_command", { command }, H).map((c) => c.grain);
      expect(grains).toEqual(["exact"]);
    },
  );

  it("yields nothing when the command carries a shell metacharacter", () => {
    expect(allowlistCandidates("run_command", { command: "df -h | grep /" }, H)).toEqual([]);
    expect(allowlistCandidates("run_command", { command: "df -h !sudo" }, H)).toEqual([]);
  });

  it("yields nothing for an empty command", () => {
    expect(allowlistCandidates("run_command", { command: "   " }, H)).toEqual([]);
  });

  it("keys exact on the trimmed command, so a different argv does not match", () => {
    const [exact] = allowlistCandidates("run_command", { command: " df -h " }, H);
    expect(exact.key).toBe("df -h");
    const other = allowlistCandidates("run_command", { command: "df --output=source" }, H);
    expect(other.some((c) => entriesEqual(c, exact))).toBe(false);
  });
});

describe("isWellFormedEntry", () => {
  const ok: AllowlistEntry = { host: H, tool: "run_command", grain: "exact", key: "df -h" };

  it("accepts a well-formed entry", () => {
    expect(isWellFormedEntry(ok)).toBe(true);
  });

  // Legacy 3a entries were {host, key} first-token prefixes. Reading them
  // forward as prefix grants would resurrect the vulnerability being closed.
  it("rejects a legacy {host, key} entry", () => {
    expect(isWellFormedEntry({ host: H, key: "df" })).toBe(false);
  });

  it.each([null, undefined, 42, "df", [], { ...ok, grain: "wat" }, { ...ok, host: "" }, { ...ok, key: "" }, { ...ok, tool: "" }])(
    "rejects malformed %s",
    (value) => {
      expect(isWellFormedEntry(value)).toBe(false);
    },
  );

  it("rejects a prefix entry whose binary left the positive list", () => {
    expect(isWellFormedEntry({ host: H, tool: "run_command", grain: "prefix", key: "sudo" })).toBe(false);
  });

  it("rejects any key carrying a shell metacharacter", () => {
    expect(isWellFormedEntry({ ...ok, key: "df -h | sh" })).toBe(false);
  });
});

describe("PREFIX_GRANTABLE_BINARIES", () => {
  it("contains only non-exec-capable introspection binaries", () => {
    for (const banned of [
      "sudo", "ssh", "find", "env", "xargs", "docker", "kubectl", "systemctl",
      "journalctl", "git", "awk", "python", "perl", "make", "nc", "tar",
      "rsync", "vim", "cat", "ls", "grep", "head", "tail", "stat", "file",
      // exec-capable via subcommand: `ip netns exec <ns> <cmd>` runs anything.
      "ip",
      // mutate live state rather than merely inspecting it.
      "ifconfig", "route", "arp", "date", "hostname",
    ]) {
      expect(PREFIX_GRANTABLE_BINARIES.has(banned)).toBe(false);
    }
  });

  it("contains the diagnostic staples", () => {
    for (const ok of ["df", "free", "uptime", "ps", "uname", "vmstat", "ss"]) {
      expect(PREFIX_GRANTABLE_BINARIES.has(ok)).toBe(true);
    }
  });

  // Pins exact membership so any future addition or removal is a deliberate,
  // visible edit rather than silent drift.
  it("has exactly the reviewed set of 24 binaries", () => {
    expect([...PREFIX_GRANTABLE_BINARIES].sort()).toEqual([
      "arch", "df", "dmesg", "du", "free", "id", "iostat", "lsblk", "lscpu",
      "lsmem", "lspci", "lsusb", "mpstat", "netstat", "nproc", "ps", "pstree",
      "ss", "uname", "uptime", "vmstat", "w", "who", "whoami",
    ]);
  });
});
