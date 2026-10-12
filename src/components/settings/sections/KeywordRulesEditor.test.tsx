import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import TerminalSection from "./TerminalSection";
import { useTerminalSettingsStore } from "@/stores/terminalSettingsStore";
import { useToggleSettingsStore } from "@/stores/toggleSettingsStore";
import { DEFAULT_KEYWORD_RULES, MAX_KEYWORD_RULES } from "@/utils/keywordMatcher";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => (params?.word ? `${key}:${params.word}` : key),
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));

const K = "settings.terminal.keywordHighlight";
const rules = () => useTerminalSettingsStore.getState().keywordRules;
const rows = () => screen.getAllByTestId("keyword-rule");
const card = () => screen.getByText(`${K}.title`).closest("[class*='rounded-xl']") as HTMLElement;
const cardSwitch = () => card().querySelector("[role='switch']") as HTMLElement;

beforeEach(() => {
  useToggleSettingsStore.setState({ values: {} });
  useTerminalSettingsStore.setState({ keywordRules: DEFAULT_KEYWORD_RULES });
});
afterEach(cleanup);

describe("keyword highlighting settings", () => {
  it("is on by default and lists the default rules", () => {
    render(<TerminalSection />);
    expect(cardSwitch().getAttribute("aria-checked")).toBe("true");
    expect(rows()).toHaveLength(3);
    expect(within(rows()[0]).getByText("fatal")).toBeTruthy();
  });

  it("hides the rules when switched off", () => {
    render(<TerminalSection />);
    fireEvent.click(cardSwitch());
    expect(useToggleSettingsStore.getState().values["keyword-highlight"]).toBe(false);
    expect(screen.queryAllByTestId("keyword-rule")).toHaveLength(0);
  });

  it("adds a word, lowercased, and removes one", () => {
    render(<TerminalSection />);
    const input = within(rows()[1]).getByRole("textbox");
    fireEvent.change(input, { target: { value: "Slow" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(rules()[1].words).toContain("slow");
    fireEvent.click(within(rows()[1]).getByLabelText(`${K}.removeWord:slow`));
    expect(rules()[1].words).not.toContain("slow");
  });

  it("switches one rule off without touching the others", () => {
    render(<TerminalSection />);
    fireEvent.click(within(rows()[2]).getByRole("switch"));
    expect(rules().map((r) => r.enabled)).toEqual([true, true, false]);
  });

  it("changes a rule's colour", async () => {
    render(<TerminalSection />);
    fireEvent.click(within(rows()[0]).getByLabelText(new RegExp(`^${K}.color`)));
    fireEvent.click(await screen.findByRole("option", { name: "themeCreator.fields.magenta" }));
    expect(rules()[0].color).toBe("magenta");
  });

  it("deletes a rule", () => {
    render(<TerminalSection />);
    fireEvent.click(within(rows()[0]).getByLabelText(`${K}.deleteRule`));
    expect(rules().map((r) => r.id)).toEqual(["warning", "success"]);
  });

  it("adds an empty rule in a colour no rule uses yet", () => {
    render(<TerminalSection />);
    fireEvent.click(screen.getByText(`${K}.addRule`));
    expect(rules()).toHaveLength(4);
    expect(rules()[3]).toMatchObject({ color: "blue", words: [], enabled: true });
  });

  it("stops adding rules at the limit", () => {
    useTerminalSettingsStore.getState().setKeywordRules(
      Array.from({ length: MAX_KEYWORD_RULES }, (_, i) => ({ id: `r${i}`, color: "red" as const, words: [], enabled: true })),
    );
    render(<TerminalSection />);
    expect((screen.getByText(`${K}.addRule`).closest("button") as HTMLButtonElement).disabled).toBe(true);
  });

  it("resets the switch and the rules together", () => {
    useTerminalSettingsStore.getState().setKeywordRules([]);
    render(<TerminalSection />);
    fireEvent.click(within(card()).getByRole("button", { name: /reset/i }));
    expect(rules()).toEqual(DEFAULT_KEYWORD_RULES);
    expect(within(card()).queryByRole("button", { name: /reset/i })).toBeNull();
  });

  it("does not show the defaults as modified once they went through the store", () => {
    useTerminalSettingsStore.getState().setKeywordRules(DEFAULT_KEYWORD_RULES);
    render(<TerminalSection />);
    expect(within(card()).queryByRole("button", { name: /reset/i })).toBeNull();
  });
});
