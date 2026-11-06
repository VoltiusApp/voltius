// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { Terminal } from "@xterm/xterm";

const h = vi.hoisted(() => ({ teamIds: new Set<string>() }));
vi.mock("@/services/teamConnectionIds", () => ({ isTeamConnection: (id: string) => h.teamIds.has(id) }));
vi.mock("@/lib/invoke", () => ({ invoke: vi.fn() }));
vi.mock("@/services/saveFile", () => ({ notify: vi.fn() }));
vi.mock("@/services/sync", () => ({ scheduleSync: vi.fn() }));

import { terminalEchoProbe } from "@/components/terminal/inputEcho";
import { ECHO_WAIT_MS, useCommandHistoryStore, type EchoProbe } from "./commandHistoryStore";
import { usePolicyStore } from "./policyStore";
import { useToggleSettingsStore } from "./toggleSettingsStore";

const NONE = { policy: {}, defaults: {} };

/**
 * A session as the history sees it: a real xterm, and the input path useTerminal
 * takes — every keystroke reaches addInput before it is sent, and whatever the
 * remote side prints comes back later through term.write.
 */
function session(id = "s1", { cols = 80, connectionId = "host-1" } = {}) {
  const term = new Terminal({ cols, rows: 10, allowProposedApi: true });
  const probe: EchoProbe = terminalEchoProbe(term);
  const print = (text: string) => new Promise<void>((resolve) => term.write(text, resolve));
  const send = (data: string) => useCommandHistoryStore.getState().addInput(id, "box", connectionId, data, probe);
  // What a shell with echo prints back for one input event.
  const echoOf = (data: string) => data.replace(/\x7f/g, "\b \b").replace(/\r/g, "\r\n");
  return {
    term,
    print,
    send,
    /** Type into a prompt that echoes: each key is sent, then shown. */
    async type(text: string) {
      for (const ch of text) {
        send(ch);
        await print(echoOf(ch));
      }
    },
    /** Type into a prompt that hides input (sudo, su, passwd): keys are sent, only Enter moves the cursor. */
    async typeHidden(text: string) {
      for (const ch of text) {
        send(ch);
        if (ch === "\r") await print("\r\n");
      }
    },
    echoOf,
  };
}

/** onWriteParsed fires after the write callback, so let it land. */
const parsed = () => new Promise((resolve) => setTimeout(resolve, 20));
const commands = () => useCommandHistoryStore.getState().entries.map((e) => e.command);
const onDisk = () => localStorage.getItem("voltius-command-history") ?? "";

beforeEach(() => {
  h.teamIds = new Set();
  localStorage.clear();
  usePolicyStore.setState({ machine: NONE, server: NONE });
  // Off and on again: drops whatever line state an earlier test left in a session.
  useToggleSettingsStore.setState({ values: { "command-history": false } });
  useToggleSettingsStore.setState({ values: {} });
  useCommandHistoryStore.setState({ entries: [], buffers: {} });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("a line is kept only once the terminal echoed it", () => {
  test("a typed command is kept", async () => {
    const s = session();
    await s.print("alice@box:~$ ");
    await s.type("ls -la\r");
    expect(commands()).toEqual(["ls -la"]);
    expect(onDisk()).toContain("ls -la");
  });

  test("a password typed at a sudo prompt is not kept", async () => {
    const s = session();
    await s.print("alice@box:~$ ");
    await s.type("sudo apt upgrade\r");
    await s.print("[sudo] password for alice: ");
    await s.typeHidden("hunter2\r");
    await parsed();
    expect(commands()).toEqual(["sudo apt upgrade"]);
    expect(onDisk()).not.toContain("hunter2");
  });

  test("a password that also appears in the prompt is not kept", async () => {
    const s = session();
    await s.print("[sudo] password for alice: ");
    await s.typeHidden("alice\r");
    await parsed();
    await s.print("Password: ");
    await s.typeHidden("Password\r");
    await parsed();
    expect(commands()).toEqual([]);
  });

  test("a password pasted at a hidden prompt is not kept, with or without its newline", async () => {
    const s = session();
    await s.print("Enter passphrase for key '/home/alice/.ssh/id_ed25519': ");
    s.send("correct horse battery staple\r");
    await s.print("\r\n");
    await parsed();
    await s.print("Password: ");
    s.send("tr0ub4dor&3");
    s.send("\r");
    await s.print("\r\n");
    await parsed();
    expect(commands()).toEqual([]);
    expect(onDisk()).not.toContain("horse");
    expect(onDisk()).not.toContain("tr0ub4dor");
  });

  test("a pasted command is kept once the shell echoes it", async () => {
    const s = session();
    await s.print("$ ");
    s.send("git status\r");
    await s.print("git status\r\n");
    await parsed();
    expect(commands()).toEqual(["git status"]);
  });

  test("an echo arriving after Enter is still kept", async () => {
    const s = session();
    await s.print("$ ");
    s.send("uptime");
    s.send("\r");
    expect(commands()).toEqual([]);
    await s.print("up");
    await parsed();
    expect(commands()).toEqual([]);
    await s.print("time\r\n 10:42:01 up 3 days\r\n$ ");
    await parsed();
    expect(commands()).toEqual(["uptime"]);
  });

  test("an echo that never comes drops the line after the wait", () => {
    vi.useFakeTimers();
    let shown = "";
    let notify = () => {};
    const probe: EchoProbe = {
      anchor: () => ({ text: () => shown, left: () => false, dispose() {} }),
      onOutput: (cb) => { notify = cb; return () => { notify = () => {}; }; },
    };
    useCommandHistoryStore.getState().addInput("s1", "box", "host-1", "whoami\r", probe);
    vi.advanceTimersByTime(ECHO_WAIT_MS + 1);
    shown = "whoami";
    notify();
    expect(commands()).toEqual([]);
  });

  test("a password typed ahead of its prompt is not kept", async () => {
    const s = session();
    await s.print("$ ");
    // Enter, then the password at once: neither the echo nor sudo's prompt has arrived yet.
    s.send("sudo -v\r");
    s.send("hunter2\r");
    await s.print("sudo -v\r\n[sudo] password for alice: ");
    await s.print("\r\n$ ");
    await parsed();
    expect(commands()).toEqual(["sudo -v"]);
    expect(onDisk()).not.toContain("hunter2");
  });

  test("a password typed on the fresh row before a slow prompt prints is not kept", async () => {
    const s = session();
    await s.print("$ ");
    await s.type("ssh prod\r");
    // The connection takes a moment; the passphrase is typed before ssh asks for it.
    s.send("Enter passphrase for key '/k':");
    s.send("\r");
    await s.print("Enter passphrase for key '/k': \r\n");
    await parsed();
    expect(commands()).toEqual(["ssh prod"]);
  });

  test("a line of mask characters is never kept", async () => {
    const s = session();
    await s.print("Password: ");
    await s.type("****\r");
    expect(commands()).toEqual([]);
  });

  test("a command longer than the terminal is wide is kept across the wrap", async () => {
    const s = session("s1", { cols: 20 });
    await s.print("alice@box:~$ ");
    await s.type("echo one two three four five\r");
    expect(commands()).toEqual(["echo one two three four five"]);
  });

  test("a right-hand prompt after the command does not hide its echo", async () => {
    const s = session();
    // zsh with RPROMPT: the right prompt is drawn with the left one, and the command is typed between.
    await s.print("~ % \x1b[70G10:42\x1b[5G");
    await s.type("make\r");
    expect(commands()).toEqual(["make"]);
  });

  test("a shell inside tmux, on the alternate screen, is recorded", async () => {
    const s = session();
    await s.print("\x1b[?1049h$ ");
    await s.type("htop\r");
    expect(commands()).toEqual(["htop"]);
  });
});

describe("line editing keeps working", () => {
  test("Backspace edits the line before it is kept", async () => {
    const s = session();
    await s.print("$ ");
    await s.type("lss\x7f -l\r");
    expect(commands()).toEqual(["ls -l"]);
  });

  test("Ctrl+C abandons the line", async () => {
    const s = session();
    await s.print("$ ");
    await s.type("rm -rf build");
    s.send("\x03");
    await s.print("^C\r\n$ ");
    await s.type("make\r");
    expect(commands()).toEqual(["make"]);
  });

  test("Ctrl+U clears the line and what follows is kept", async () => {
    const s = session();
    await s.print("$ ");
    await s.type("git push --force");
    s.send("\x15");
    await s.print("\r\x1b[K$ ");
    await s.type("git push\r");
    expect(commands()).toEqual(["git push"]);
  });

  test("Ctrl+U at a password prompt still keeps nothing", async () => {
    const s = session();
    await s.print("[sudo] password for alice: ");
    await s.typeHidden("wrong");
    s.send("\x15");
    await s.typeHidden("hunter2\r");
    await parsed();
    expect(commands()).toEqual([]);
  });

  test("repeating a command back to back keeps one entry", async () => {
    const s = session();
    await s.print("$ ");
    await s.type("ls\r");
    await s.print("$ ");
    await s.type("ls\r");
    expect(commands()).toEqual(["ls"]);
  });

  test("a team host's commands stay in memory only", async () => {
    h.teamIds = new Set(["team-host"]);
    const team = session("s1", { connectionId: "team-host" });
    await team.print("$ ");
    await team.type("cat /etc/team-secret\r");
    const own = session("s2");
    await own.print("$ ");
    await own.type("ls\r");
    expect(commands()).toEqual(["cat /etc/team-secret", "ls"]);
    expect(onDisk()).not.toContain("team-secret");
    expect(onDisk()).toContain("ls");
  });
});

describe("the command-history toggle", () => {
  const PARKED = "voltius.parked-ui-state.acct-b";

  test("off records nothing and deletes what was kept, here and in parked accounts", async () => {
    const s = session();
    await s.print("$ ");
    await s.type("ls\r");
    localStorage.setItem(PARKED, JSON.stringify({ "voltius-command-history": "old commands", "voltius-vaults": "vaults" }));

    useToggleSettingsStore.getState().set("command-history", false);

    expect(commands()).toEqual([]);
    expect(onDisk()).not.toContain("ls");
    expect(JSON.parse(localStorage.getItem(PARKED)!)).toEqual({ "voltius-vaults": "vaults" });

    await s.print("$ ");
    await s.type("whoami\r");
    expect(commands()).toEqual([]);
  });

  test("a line still waiting for its echo when history goes off is not kept", async () => {
    const s = session();
    await s.print("$ ");
    s.send("uptime\r");
    useToggleSettingsStore.getState().set("command-history", false);
    useToggleSettingsStore.getState().set("command-history", true);
    await s.print("uptime\r\n");
    await parsed();
    expect(commands()).toEqual([]);
    await s.print("$ ");
    await s.type("pwd\r");
    expect(commands()).toEqual(["pwd"]);
  });

  test("a team policy that turns history off clears it too", async () => {
    const s = session();
    await s.print("$ ");
    await s.type("ls\r");
    usePolicyStore.setState({ machine: { policy: { "appSettings.toggles.command-history": false }, defaults: {} } });
    expect(commands()).toEqual([]);
    await s.print("$ ");
    await s.type("pwd\r");
    expect(commands()).toEqual([]);
  });
});
