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
console.log("ALL PASS");
