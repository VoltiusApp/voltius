import { handleBack, initialMobileNavState, type MobileNavState } from "./mobileNavCore.ts";
import { test } from "vitest";

test("mobileNavCore", async () => {
function assertEqual<T>(actual: T, expected: T, msg: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    console.error(`FAIL ${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    throw new Error(msg);
  }
}

// back closes sheet first
{
  const s: MobileNavState = { tab: "hosts", stack: [{ kind: "host-edit" }], sheet: { kind: "vault-switcher" } };
  const r = handleBack(s);
  assertEqual(r.handled, true, "sheet back handled");
  assertEqual(r.state.sheet, null, "sheet closed");
  assertEqual(r.state.stack.length, 1, "stack untouched while sheet open");
}

// back pops stack second
{
  const s: MobileNavState = { tab: "hosts", stack: [{ kind: "host-edit" }], sheet: null };
  const r = handleBack(s);
  assertEqual(r.handled, true, "stack back handled");
  assertEqual(r.state.stack.length, 0, "stack popped");
}

// back from non-hosts tab returns to hosts
{
  const s: MobileNavState = { tab: "terminal", stack: [], sheet: null };
  const r = handleBack(s);
  assertEqual(r.handled, true, "tab back handled");
  assertEqual(r.state.tab, "hosts", "tab reset to hosts");
}

// back at root is unhandled (system backgrounds the app)
{
  const s: MobileNavState = { tab: "hosts", stack: [], sheet: null };
  const r = handleBack(s);
  assertEqual(r.handled, false, "root back unhandled");
}

// initial state
assertEqual(initialMobileNavState.tab, "hosts", "initial tab is hosts");

// panel kinds push + pop like any other screen, carrying sessionId
{
  const s: MobileNavState = { tab: "terminal", stack: [{ kind: "panel", section: "plugin:docker:docker", sessionId: "sess-1" }], sheet: null };
  const r = handleBack(s);
  assertEqual(r.handled, true, "panel back pops stack");
  assertEqual(r.state.stack.length, 0, "panel stack popped");
}
{
  const s: MobileNavState = {
    tab: "terminal",
    stack: [{ kind: "panel", section: "plugin:monitoring:monitoring", sessionId: "sess-1" }, { kind: "panel", section: "plugin:docker:docker", sessionId: "sess-1" }],
    sheet: null,
  };
  const r = handleBack(s);
  assertEqual(r.handled, true, "nested panel back handled");
  assertEqual(r.state.stack.length, 1, "only top panel popped");
  assertEqual((r.state.stack[0] as { section: string }).section, "plugin:monitoring:monitoring", "lower panel remains under");
}

// more-page stacks: back pops top, root remains
{
  const s: MobileNavState = {
    tab: "more",
    stack: [
      { kind: "more-page", page: "keychain" },
      { kind: "more-page", page: "keychain" },
    ],
    sheet: null,
  };
  const r = handleBack(s);
  assertEqual(r.handled, true, "more-page back pops one level");
  assertEqual(r.state.stack.length, 1, "top more-page popped");
  assertEqual((r.state.stack[0] as { kind: string }).kind, "more-page", "root more-page remains");
}

// panel-sftp carries a connectionId and pops like any screen
{
  const s: MobileNavState = { tab: "hosts", stack: [{ kind: "panel-sftp", connectionId: "conn-1" }], sheet: null };
  const r = handleBack(s);
  assertEqual(r.handled, true, "panel-sftp back pops stack");
  assertEqual(r.state.stack.length, 0, "panel-sftp stack popped");
}

// back from the sftp tab returns to hosts
{
  const s: MobileNavState = { tab: "sftp", stack: [], sheet: null };
  const r = handleBack(s);
  assertEqual(r.handled, true, "sftp tab back handled");
  assertEqual(r.state.tab, "hosts", "sftp tab reset to hosts");
}

// back clears snippet-target sheet
{
  const s = { ...initialMobileNavState, sheet: { kind: "snippet-target", snippetId: "x", mode: "execute" } as const };
  const r = handleBack(s);
  assertEqual(r.handled, true, "back handled for snippet-target sheet");
  assertEqual(r.state.sheet, null, "snippet-target sheet cleared on back");
}

// vault settings: Back walks a sub-page, then the page, like any pushed page
{
  const s: MobileNavState = {
    tab: "more",
    stack: [{ kind: "vault-settings", vaultId: "v2" }, { kind: "vault-settings", vaultId: "v2", page: "roles" }],
    sheet: null,
  };
  const r1 = handleBack(s);
  assertEqual(r1.state.stack, [{ kind: "vault-settings", vaultId: "v2" }], "sub-page popped first");
  const r2 = handleBack(r1.state);
  assertEqual(r2.state.stack, [], "then the vault settings page");
  assertEqual(r2.state.tab, "more", "the tab stays");
}
});
