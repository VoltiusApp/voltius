import { test, expect, vi, beforeEach } from "vitest";

vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));

import {
  openWebSocket,
  appendSshOutputBuffer,
  drainSshOutputBuffer,
  encryptData,
  importSessionKey,
} from "./multiplayerService";

class MockWS {
  static last: MockWS;
  static OPEN = 1;
  readyState = MockWS.OPEN;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  constructor(public url: string) {
    MockWS.last = this;
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {}
}
vi.stubGlobal("WebSocket", MockWS as unknown as typeof WebSocket);

const noopCallbacks = () => ({
  onOutput: vi.fn(),
  onInput: vi.fn(),
  onControlUpdate: vi.fn(),
  onParticipantJoined: vi.fn(),
  onParticipantLeft: vi.fn(),
  onParticipantList: vi.fn(),
  onSessionEnded: vi.fn(),
});

const key = () => importSessionKey(new Uint8Array(32).fill(4));

beforeEach(() => {
  MockWS.last = undefined as unknown as MockWS;
});

test("openWebSocket rewrites https->wss and appends invite_token", async () => {
  openWebSocket("https://s", "sid", "jwt", "Dana", await key(), noopCallbacks(), "tok");
  expect(MockWS.last.url).toMatch(/^wss:\/\/s\/v1\/terminal-sessions\/sid\/ws\?/);
  expect(MockWS.last.url).toContain("invite_token=tok");
  expect(MockWS.last.url).toContain("display_name=Dana");
});

test("onmessage dispatches control/participant events to callbacks", async () => {
  const cb = noopCallbacks();
  openWebSocket("https://s", "sid", "jwt", "Dana", await key(), cb);
  const fire = (msg: unknown) => MockWS.last.onmessage!({ data: JSON.stringify(msg) });

  fire({ type: "control_update", holder: "u1", requester: "u2" });
  fire({ type: "participant_joined", user_id: "u3", display_name: "Eve" });
  fire({ type: "participant_left", user_id: "u3" });
  fire({ type: "participant_list", participants: [{ user_id: "u1", display_name: "A" }] });
  fire({ type: "session_ended" });

  expect(cb.onControlUpdate).toHaveBeenCalledWith("u1", "u2");
  expect(cb.onParticipantJoined).toHaveBeenCalledWith({ user_id: "u3", display_name: "Eve" });
  expect(cb.onParticipantLeft).toHaveBeenCalledWith("u3");
  expect(cb.onParticipantList).toHaveBeenCalledWith([{ user_id: "u1", display_name: "A" }]);
  expect(cb.onSessionEnded).toHaveBeenCalledTimes(1);
});

test("output messages are decrypted before reaching onOutput", async () => {
  const cb = noopCallbacks();
  const k = await key();
  openWebSocket("https://s", "sid", "jwt", "Dana", k, cb);
  const payload = new TextEncoder().encode("terminal bytes");
  const encrypted = await encryptData(k, payload);
  await MockWS.last.onmessage!({ data: JSON.stringify({ type: "output", data: encrypted }) });
  // jsdom TextEncoder produces a cross-realm Uint8Array; toHaveBeenCalledWith's
  // deep-equal fails on that, so compare plain arrays of byte values instead.
  expect(Array.from(cb.onOutput.mock.calls[0][0] as Uint8Array)).toEqual(Array.from(payload));
});

test("malformed message JSON is swallowed", async () => {
  const cb = noopCallbacks();
  openWebSocket("https://s", "sid", "jwt", "Dana", await key(), cb);
  await MockWS.last.onmessage!({ data: "not-json{" });
  expect(cb.onOutput).not.toHaveBeenCalled();
});

test("sendOutput encrypts, send is suppressed when socket not open", async () => {
  const conn = openWebSocket("https://s", "sid", "jwt", "Dana", await key(), noopCallbacks());
  await conn.sendOutput(new Uint8Array([1, 2, 3]));
  expect(MockWS.last.sent).toHaveLength(1);
  expect(JSON.parse(MockWS.last.sent[0]).type).toBe("output");

  MockWS.last.readyState = 3; // CLOSED
  conn.requestControl();
  expect(MockWS.last.sent).toHaveLength(1); // suppressed
});

test("initial snapshot is encrypted and sent on open", async () => {
  const k = await key();
  openWebSocket("https://s", "sid", "jwt", "Dana", k, noopCallbacks(), undefined, new Uint8Array([5, 5]));
  await MockWS.last.onopen!();
  expect(MockWS.last.sent).toHaveLength(1);
  expect(JSON.parse(MockWS.last.sent[0]).type).toBe("output");
});

test("output buffer evicts oldest chunks past 64KB and drains in order", () => {
  appendSshOutputBuffer("s1", new Uint8Array([1, 2]));
  appendSshOutputBuffer("s1", new Uint8Array([3]));
  // toEqual on Uint8Array breaks cross-realm under jsdom; compare byte arrays.
  expect(Array.from(drainSshOutputBuffer("s1")!)).toEqual([1, 2, 3]);
  expect(drainSshOutputBuffer("s1")).toBeNull(); // cleared after drain

  appendSshOutputBuffer("s2", new Uint8Array(40 * 1024).fill(9));
  appendSshOutputBuffer("s2", new Uint8Array(40 * 1024).fill(8)); // pushes total > 64KB, evicts first
  const drained = drainSshOutputBuffer("s2")!;
  expect(drained.length).toBeLessThanOrEqual(64 * 1024);
});
