import { describe, it, expect } from "vitest";
import { isStatusBarVisible } from "./sessionVisibility";

const base = {
  sessionId: "s1",
  activeSessionId: "s1",
  showSplitWorkspace: false,
  overlayContent: false,
  sftpPanelOpen: false,
};

describe("isStatusBarVisible", () => {
  it("is visible for a normal focused session", () => {
    expect(isStatusBarVisible(base)).toBe(true);
  });

  it("is not visible for a background session mounted but not shown", () => {
    expect(isStatusBarVisible({ ...base, sessionId: "s2" })).toBe(false);
  });

  it("is not visible when a split tab is active", () => {
    expect(isStatusBarVisible({ ...base, showSplitWorkspace: true })).toBe(false);
  });

  it("is not visible when nav is away from the terminal", () => {
    expect(isStatusBarVisible({ ...base, overlayContent: true })).toBe(false);
  });

  it("is not visible when the SFTP page is open", () => {
    expect(isStatusBarVisible({ ...base, sftpPanelOpen: true })).toBe(false);
  });

  it("is not visible when there is no active session", () => {
    expect(isStatusBarVisible({ ...base, activeSessionId: null })).toBe(false);
  });
});
