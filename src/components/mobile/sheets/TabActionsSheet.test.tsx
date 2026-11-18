import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { TerminalSession } from "@/types";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: ({ icon }: { icon: string }) => <i data-icon={icon} /> }));

import TabActionsSheet from "./TabActionsSheet";
import { useSessionStore } from "@/stores/sessionStore";
import { useLayoutStore } from "@/stores/layoutStore";

const locked: TerminalSession = { id: "a", connectionId: "c", connectionName: "prod", status: "connected", type: "ssh", locked: true };
const row = (slug: string) => document.querySelector(`[data-tab-action='${slug}']`) as HTMLButtonElement;

describe("TabActionsSheet", () => {
  afterEach(cleanup);

  test("a locked tab offers unlock and greys out close with the reason", () => {
    useSessionStore.setState({ sessions: [locked], activeSessionId: "a" });
    useLayoutStore.setState({ splitTabs: [], pinnedKeys: [] });
    render(<TabActionsSheet session={locked} onClose={() => {}} />);
    expect(row("pin")).toBeTruthy();
    expect(row("unlock")).toBeTruthy();
    expect(row("close").disabled).toBe(true);
    expect(document.body.textContent).toContain("layout.titleBar.lock.closeBlocked");
    fireEvent.click(row("unlock"));
    expect(useSessionStore.getState().sessions[0].locked).toBe(false);
  });
});
