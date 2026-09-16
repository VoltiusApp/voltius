import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({ openUrl: vi.fn(async () => {}), writeClipboard: vi.fn(async () => {}) }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: h.openUrl }));
vi.mock("@/utils/clipboard", () => ({ writeClipboard: h.writeClipboard }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock("@iconify/react", () => ({ Icon: () => null }));

const { NotesPreview } = await import("./NotesPreview");

afterEach(() => { cleanup(); vi.clearAllMocks(); });

function renderPreview(value: string, props: Partial<Parameters<typeof NotesPreview>[0]> = {}) {
  const onChange = vi.fn();
  const utils = render(<NotesPreview value={value} onChange={onChange} {...props} />);
  return { onChange, ...utils };
}

describe("NotesPreview", () => {
  test("renders gfm tables and headings", () => {
    renderPreview("# Title\n\n| a | b |\n| - | - |\n| 1 | 2 |");
    expect(screen.getByRole("heading", { name: "Title" })).toBeTruthy();
    expect(screen.getByRole("table")).toBeTruthy();
  });

  test("escapes raw html", () => {
    const { container } = renderPreview("<img src=x onerror=alert(1)><b>bold</b>");
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
  });

  test("opens allowed links through the opener, never navigating", () => {
    renderPreview("[docs](https://x.io)");
    fireEvent.click(screen.getByText("docs"));
    expect(h.openUrl).toHaveBeenCalledWith("https://x.io");
  });

  test("renders disallowed links as plain text", () => {
    const { container } = renderPreview("[bad](javascript:alert(1)) [file](file:///etc/passwd)");
    expect(container.querySelector("a")).toBeNull();
    expect(screen.getByText("bad")).toBeTruthy();
  });

  test("renders images as links and fetches nothing", () => {
    const { container } = renderPreview("![diagram](https://x.io/d.png)");
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("diagram")).toBeTruthy();
  });

  test("toggling a checkbox rewrites the matching source line, even after a code block", () => {
    const src = "```\n- [ ] not a task\n```\n\n- [ ] first\n- [x] second";
    const { onChange } = renderPreview(src);
    const boxes = screen.getAllByRole("checkbox");
    fireEvent.click(boxes[1]);
    expect(onChange).toHaveBeenCalledWith("```\n- [ ] not a task\n```\n\n- [ ] first\n- [ ] second");
  });

  test("checkboxes are disabled when read-only", () => {
    renderPreview("- [ ] a", { readOnly: true });
    expect((screen.getByRole("checkbox") as HTMLInputElement).disabled).toBe(true);
  });

  test("code blocks copy their text and send it only when onRunCode is given", () => {
    const onRunCode = vi.fn();
    renderPreview("```sh\nsystemctl restart nginx\n```", { onRunCode });
    fireEvent.click(screen.getByTitle("notes.code.copy"));
    expect(h.writeClipboard).toHaveBeenCalledWith("systemctl restart nginx");
    fireEvent.click(screen.getByTitle("notes.code.sendToTerminal"));
    expect(onRunCode).toHaveBeenCalledWith("systemctl restart nginx");
    cleanup();
    renderPreview("```\nls\n```");
    expect(screen.queryByTitle("notes.code.sendToTerminal")).toBeNull();
  });

  test("double click requests edit unless read-only", () => {
    const onRequestEdit = vi.fn();
    const { container } = renderPreview("text", { onRequestEdit });
    fireEvent.doubleClick(container.firstChild as Element);
    expect(onRequestEdit).toHaveBeenCalledTimes(1);
    cleanup();
    const second = renderPreview("text", { onRequestEdit, readOnly: true });
    fireEvent.doubleClick(second.container.firstChild as Element);
    expect(onRequestEdit).toHaveBeenCalledTimes(1);
  });
});
