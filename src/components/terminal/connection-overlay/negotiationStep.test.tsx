import { describe, expect, test, vi } from "vitest";
import type { BackendErrorCode } from "@/services/backendErrors";
import { renderHook } from "@testing-library/react";

vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));
vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => {}) }));

const { getSftpSteps, getSshSteps } = await import("./constants");
const { useConnectionSteps } = await import("./hooks");

type Status = "connecting" | "error";

function failWith(errorCode: BackendErrorCode | undefined, configs = getSshSteps()) {
  const { result, rerender } = renderHook(
    ({ status }: { status: Status }) => useConnectionSteps({ status, errorCode, stepConfigs: configs, stepEventName: "ssh-step-s1" }),
    { initialProps: { status: "connecting" as Status } },
  );
  rerender({ status: "error" });
  return result.current.steps.map((s) => [s.id, s.status]);
}

describe("negotiation failure step", () => {
  // The backend announces TCP only after the handshake, so without the code TCP takes the blame.
  test("an algorithm mismatch fails the SSH handshake, not the TCP connection", () => {
    expect(failWith("ssh-legacy-algorithms-required")).toEqual([
      ["tcp_connected", "done"],
      ["handshake", "error"],
      ["authenticating", "pending"],
      ["opening_shell", "pending"],
    ]);
  });

  test.each(["ssh-auth-timeout", "ssh-tailscale-check-timeout", "ssh-tailscale-check-denied"] as const)(
    "%s marks authentication when the overlay missed the live step events", (code) => {
      expect(failWith(code).slice(0, 3)).toEqual([
        ["tcp_connected", "done"], ["handshake", "done"], ["authenticating", "error"],
      ]);
    },
  );

  test("the SFTP steps blame the handshake too", () => {
    expect(failWith("ssh-no-common-algorithm", getSftpSteps()).slice(0, 2)).toEqual([
      ["tcp_connected", "done"],
      ["handshake", "error"],
    ]);
  });

  test("an uncoded failure before any step still marks the first one", () => {
    expect(failWith(undefined)[0]).toEqual(["tcp_connected", "error"]);
  });
});
