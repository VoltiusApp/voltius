import { handleBack, initialMobileNavState, type MobileNavState } from "./mobileNavCore.ts";

function assertEqual<T>(actual: T, expected: T, msg: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    console.error(`FAIL ${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    throw new Error(msg);
  }
  console.log(`PASS ${msg}`);
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
  const s: MobileNavState = { tab: "terminal", stack: [{ kind: "panel-docker", sessionId: "sess-1" }], sheet: null };
  const r = handleBack(s);
  assertEqual(r.handled, true, "panel-docker back pops stack");
  assertEqual(r.state.stack.length, 0, "panel-docker stack popped");
}
{
  const s: MobileNavState = {
    tab: "terminal",
    stack: [{ kind: "panel-metrics", sessionId: "sess-1" }, { kind: "panel-docker", sessionId: "sess-1" }],
    sheet: null,
  };
  const r = handleBack(s);
  assertEqual(r.handled, true, "nested panel back handled");
  assertEqual(r.state.stack.length, 1, "only top panel popped");
  assertEqual((r.state.stack[0] as { kind: string }).kind, "panel-metrics", "panel-metrics remains under");
}

// more-page carries an optional folderId for folder drill-in
{
  const s: MobileNavState = {
    tab: "more",
    stack: [
      { kind: "more-page", page: "keychain" },
      { kind: "more-page", page: "keychain", folderId: "f1" },
    ],
    sheet: null,
  };
  const r = handleBack(s);
  assertEqual(r.handled, true, "more-page folder back pops one level");
  assertEqual(r.state.stack.length, 1, "drilled-in folder popped");
  assertEqual((r.state.stack[0] as { folderId?: string }).folderId, undefined, "root more-page remains");
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

console.log("ALL PASS");
