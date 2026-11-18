import { test, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent, screen } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
const h = vi.hoisted(() => ({ saveTextFile: vi.fn(async () => true) }));
vi.mock("@/utils/clipboard", () => ({ writeClipboard: vi.fn(async () => {}) }));
vi.mock("@/services/saveFile", () => ({ saveTextFile: h.saveTextFile }));
vi.mock("@/components/shared/CodeField", () => ({
  CodeField: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <textarea value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

import EnvVarsPanel from "./EnvVarsPanel";

afterEach(cleanup);

const vars = [{ id: "1", key: "A", value: "a" }];

function renderPanel() {
  const onChange = vi.fn();
  render(<EnvVarsPanel envVars={vars} onChange={onChange} onBack={() => {}} />);
  return onChange;
}

test("pasting a .env into a key field merges it into the list", () => {
  const onChange = renderPanel();
  fireEvent.paste(screen.getByDisplayValue("A"), { clipboardData: { getData: () => "A=x\nB=y" } });
  expect(onChange.mock.calls[0][0].map((e: { key: string; value: string }) => [e.key, e.value])).toEqual([["A", "x"], ["B", "y"]]);
});

test("a plain paste into a key field is left to the browser", () => {
  const onChange = renderPanel();
  fireEvent.paste(screen.getByDisplayValue("A"), { clipboardData: { getData: () => "PLAIN" } });
  expect(onChange).not.toHaveBeenCalled();
});

test("raw mode edits the list as .env text and reports ignored lines", () => {
  const onChange = renderPanel();
  fireEvent.click(screen.getByRole("radio", { name: ".env" }));
  const textarea = screen.getByDisplayValue("A=a");
  fireEvent.change(textarea, { target: { value: "A=new\nnot a var\nC=3" } });
  expect(onChange).toHaveBeenLastCalledWith([{ id: "1", key: "A", value: "new" }, expect.objectContaining({ key: "C", value: "3" })]);
  expect(screen.getByText("connections.envVarsPanel.skippedLines")).toBeTruthy();
  expect(screen.getByText("not a var")).toBeTruthy();
});

test("download saves the variables as a .env file", () => {
  renderPanel();
  fireEvent.click(screen.getByText("connections.envVarsPanel.downloadButton"));
  expect(h.saveTextFile).toHaveBeenCalledWith(".env", "A=a\n");
});
