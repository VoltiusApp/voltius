import { describe, test, expect, afterEach, beforeEach, vi } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { useSessionStore } from "@/stores/sessionStore";
import { useUIStore } from "@/stores/uiStore";
import { useModifierLatchStore } from "@/stores/modifierLatchStore";
import { initialLatch } from "@/stores/modifierLatchCore";

const h = vi.hoisted(() => ({ key: vi.fn(), write: vi.fn(), panel: vi.fn() }));
vi.mock("@/services/terminalInput", () => ({ sendSpecialKey: h.key }));
vi.mock("@/hooks/useTerminal", () => ({ writeToSession: h.write }));
vi.mock("@/lib/haptics", () => ({ haptic: () => true }));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("./terminalPanelItems", () => ({
  useTerminalPanelItems: () => [{ key: "sftp", icon: "lucide:folder-open", label: "SFTP", onTap: h.panel }],
}));

import MobileKeysDrawer from "./MobileKeysDrawer";

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const at = (x: number, y: number) => ({ touches: [{ clientX: x, clientY: y }], changedTouches: [{ clientX: x, clientY: y }] });
const tap = (el: Element, end = at(10, 10)) => { fireEvent.touchStart(el, at(10, 10)); fireEvent.touchEnd(el, end); };
const key = (c: HTMLElement, id: string) => c.querySelector<HTMLElement>(`[data-mobile-drawer-key="${id}"]`)!;
const tabButton = (c: HTMLElement, label: string) => [...c.querySelectorAll("button")].find((b) => b.textContent === label)!;

beforeEach(() => {
  vi.clearAllMocks();
  useSessionStore.setState({ activeSessionId: "s1" });
  useUIStore.setState({ terminalKeysDrawerTab: "nav" });
  useModifierLatchStore.setState(initialLatch);
});
afterEach(cleanup);

describe("MobileKeysDrawer", () => {
  test("a Nav key goes out as a special key", () => {
    const { container } = render(<MobileKeysDrawer />);
    tap(key(container, "Home"));
    expect(h.key).toHaveBeenCalledWith("s1", "Home", { ctrl: false, alt: false, shift: false });
  });

  test("a finger that slides off the key sends nothing", () => {
    const { container } = render(<MobileKeysDrawer />);
    tap(key(container, "Home"), at(10, 40));
    expect(h.key).not.toHaveBeenCalled();
  });

  test("Shift applies to the next key once", () => {
    const { container } = render(<MobileKeysDrawer />);
    fireEvent.touchStart(container.querySelector('[data-mobile-key="shift"]')!);
    fireEvent.touchEnd(container.querySelector('[data-mobile-key="shift"]')!);
    fireEvent.click(tabButton(container, "mobile.keysDrawer.tabs.fn"));
    tap(key(container, "F5"));
    expect(h.key).toHaveBeenCalledWith("s1", "F5", { ctrl: false, alt: false, shift: true });
    expect(useModifierLatchStore.getState().shift).toBe("off");
  });

  test("switching tabs is remembered", () => {
    const { container } = render(<MobileKeysDrawer />);
    fireEvent.click(tabButton(container, "mobile.keysDrawer.tabs.edit"));
    expect(useUIStore.getState().terminalKeysDrawerTab).toBe("edit");
  });

  test("an Edit chord writes its bytes and leaves the latch alone", () => {
    useUIStore.setState({ terminalKeysDrawerTab: "edit" });
    useModifierLatchStore.getState().tap("alt");
    const { container } = render(<MobileKeysDrawer />);
    tap(key(container, "^W"));
    expect(h.write).toHaveBeenCalledWith("s1", "\x17");
    expect(useModifierLatchStore.getState().alt).toBe("armed");
  });

  test("the Panels tab opens a terminal panel", () => {
    useUIStore.setState({ terminalKeysDrawerTab: "panels" });
    const { container } = render(<MobileKeysDrawer />);
    fireEvent.click(container.querySelector('[data-mobile-panel-quick="sftp"]')!);
    expect(h.panel).toHaveBeenCalled();
  });
});
