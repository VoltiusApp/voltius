import { afterEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";

const h = vi.hoisted(() => ({ offset: 0, listeners: new Set<() => void>(), scrollToBottom: vi.fn() }));
vi.mock("@/hooks/useTerminal", () => ({
  getScrollOffset: () => h.offset,
  subscribeTerminalScroll: (fn: () => void) => { h.listeners.add(fn); return () => h.listeners.delete(fn); },
  getTerminalApi: () => ({ scrollToBottom: h.scrollToBottom }),
}));
vi.mock("@/lib/haptics", () => ({ haptic: () => true }));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

import MobileLivePill from "./MobileLivePill";

const pill = (c: HTMLElement) => c.querySelector<HTMLElement>("[data-mobile-live-pill]");
const scrollTo = (offset: number) => act(() => { h.offset = offset; h.listeners.forEach((fn) => fn()); });

afterEach(() => { cleanup(); h.offset = 0; h.listeners.clear(); vi.clearAllMocks(); });

describe("MobileLivePill", () => {
  test("is hidden at the live prompt and appears once scrolled up", () => {
    const { container } = render(<MobileLivePill sessionId="s1" />);
    expect(pill(container)).toBeNull();
    scrollTo(40);
    expect(pill(container)).not.toBeNull();
    scrollTo(0);
    expect(pill(container)).toBeNull();
  });

  test("a tap returns the terminal to the bottom", () => {
    h.offset = 12;
    const { container } = render(<MobileLivePill sessionId="s1" />);
    fireEvent.click(pill(container)!);
    expect(h.scrollToBottom).toHaveBeenCalled();
  });
});
