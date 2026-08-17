import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, act } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  // Interpolates, because the countdown assertions read the substituted value.
  useTranslation: () => ({
    t: (k: string, opts?: Record<string, unknown>) => (opts?.time ? `${k} ${opts.time}` : k),
  }),
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));

const writeClipboard = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@/utils/clipboard", () => ({ writeClipboard }));

const mintSessionCode = vi.hoisted(() => vi.fn());
vi.mock("@/services/multiplayerService", () => ({ mintSessionCode }));

import { SpokenCodeRow } from "./SpokenCodeRow";

function mintsIn(seconds: number, code = "K7M2-P9QX-3B") {
  mintSessionCode.mockResolvedValue({
    code,
    expiresAt: new Date(Date.now() + seconds * 1000).toISOString(),
  });
}

const T0 = Date.parse("2026-08-17T09:00:00.000Z");

/**
 * Fakes the clock the component reads along with the timers it schedules, and
 * advances only when told to. `shouldAdvanceTime` must stay off: combined with a
 * fixed expiry it let real wall time leak into the arithmetic, so the first tick
 * read 0:00 once real UTC passed the fixture's expiry.
 */
function withControlledClock(startMs = T0) {
  vi.useFakeTimers({
    toFake: ["Date", "setInterval", "clearInterval", "setTimeout", "clearTimeout"],
  });
  vi.setSystemTime(startMs);
  return {
    async advance(ms: number) {
      await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
    },
  };
}

/** Flushes the mint promise without waitFor, which would poll on faked timers. */
async function mintWithFakeTimers() {
  fireEvent.click(screen.getByRole("button"));
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
}

function expiringAt(offsetMs: number, code = "K7M2-P9QX-3B") {
  mintSessionCode.mockResolvedValue({
    code,
    expiresAt: new Date(T0 + offsetMs).toISOString(),
  });
}

async function mint() {
  fireEvent.click(screen.getByRole("button"));
  await waitFor(() => expect(screen.getByRole("textbox")).toBeTruthy());
}

beforeEach(() => {
  writeClipboard.mockClear();
  mintSessionCode.mockReset();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

test("mints only when asked, so opening the tab does not spend a code", () => {
  mintsIn(600);
  render(<SpokenCodeRow sessionId="sess-1" />);

  expect(mintSessionCode).not.toHaveBeenCalled();
  expect(screen.queryByRole("textbox")).toBeNull();
});

test("shows the minted code and copies exactly what it displays", async () => {
  mintsIn(600);
  render(<SpokenCodeRow sessionId="sess-1" />);
  await mint();

  const field = screen.getByRole("textbox") as HTMLInputElement;
  expect(field.value).toBe("K7M2-P9QX-3B");
  expect(mintSessionCode).toHaveBeenCalledWith("sess-1");

  fireEvent.click(screen.getByText("common.action.copy"));
  await waitFor(() => expect(writeClipboard).toHaveBeenCalledWith("K7M2-P9QX-3B"));
});

test("groups a code the server sent unformatted", async () => {
  mintsIn(600, "K7M2P9QX3B");
  render(<SpokenCodeRow sessionId="sess-1" />);
  await mint();

  expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("K7M2-P9QX-3B");
});

test("counts down toward expiry", async () => {
  const clock = withControlledClock();
  expiringAt(600_000);
  render(<SpokenCodeRow sessionId="sess-1" />);
  await mintWithFakeTimers();

  expect(screen.getByText(/expiresIn 10:00/)).toBeTruthy();
  await clock.advance(62_000);
  expect(screen.getByText(/expiresIn 8:58/)).toBeTruthy();
});

// An expired code is worse than no code: it looks usable and fails at the guest's end.
test("drops an expired code and offers a fresh one", async () => {
  const clock = withControlledClock();
  expiringAt(5_000);
  render(<SpokenCodeRow sessionId="sess-1" />);
  await mintWithFakeTimers();

  await clock.advance(6_000);

  expect(screen.queryByRole("textbox")).toBeNull();
  expect(screen.getByText("terminal.share.codeExpired")).toBeTruthy();
});

test("regenerating replaces the code, matching the server revoking the old one", async () => {
  mintsIn(600, "K7M2-P9QX-3B");
  render(<SpokenCodeRow sessionId="sess-1" />);
  await mint();

  mintsIn(600, "AAAA-BBBB-CC");
  fireEvent.click(screen.getByText("terminal.share.newCode"));

  await waitFor(() =>
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("AAAA-BBBB-CC"),
  );
});

test("surfaces a mint failure instead of showing a stale code", async () => {
  mintSessionCode.mockRejectedValue(new Error("boom"));
  render(<SpokenCodeRow sessionId="sess-1" />);

  fireEvent.click(screen.getByRole("button"));

  await waitFor(() => expect(screen.getByText("boom")).toBeTruthy());
  expect(screen.queryByRole("textbox")).toBeNull();
});

// The interval must die with the component; a leaked one ticks against an unmounted
// tree for the rest of the session (the leak PR #128 had to fix).
test("clears its countdown on unmount", async () => {
  withControlledClock();
  expiringAt(600_000);
  const view = render(<SpokenCodeRow sessionId="sess-1" />);
  await mintWithFakeTimers();

  const clearSpy = vi.spyOn(globalThis, "clearInterval");
  view.unmount();

  expect(clearSpy).toHaveBeenCalled();
});
