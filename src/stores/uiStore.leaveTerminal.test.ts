// @vitest-environment jsdom
import { test, expect, beforeEach } from "vitest";
import { useUIStore } from "@/stores/uiStore";

beforeEach(() => {
  useUIStore.setState({ activeNav: "hosts", lastPageNav: "hosts" });
});

test("leaving the terminal returns to the page shown before it", () => {
  const ui = useUIStore.getState();
  ui.setActiveNav("snippets");
  ui.setActiveNav("terminal");
  ui.leaveTerminal();
  expect(useUIStore.getState().activeNav).toBe("snippets");
});

test("leaving the terminal from another page stays on that page", () => {
  const ui = useUIStore.getState();
  ui.setActiveNav("terminal");
  ui.setActiveNav("keychain");
  ui.leaveTerminal();
  expect(useUIStore.getState().activeNav).toBe("keychain");
});

test("the members shortcuts count as the page shown before the terminal", () => {
  const ui = useUIStore.getState();
  ui.openMembersNav();
  ui.setActiveNav("terminal");
  ui.leaveTerminal();
  expect(useUIStore.getState().activeNav).toBe("members");
});

test("hosts is the fallback when no page was shown yet", () => {
  useUIStore.setState({ activeNav: "terminal" });
  useUIStore.getState().leaveTerminal();
  expect(useUIStore.getState().activeNav).toBe("hosts");
});
