import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { InlineNameEditor } from "./InlineNameEditor";

const onCommit = vi.fn();
const onCancel = vi.fn();

const setup = (value = "web-01") =>
  render(<InlineNameEditor value={value} onCommit={onCommit} onCancel={onCancel} />);

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

const input = () => screen.getByRole("textbox") as HTMLInputElement;

test("opens on the current label, selected, so typing replaces it", () => {
  setup();
  expect(input().value).toBe("web-01");
  expect(document.activeElement).toBe(input());
  expect(input().selectionStart).toBe(0);
  expect(input().selectionEnd).toBe("web-01".length);
});

test("Enter commits what was typed", () => {
  setup();
  fireEvent.change(input(), { target: { value: "deploy" } });
  fireEvent.keyDown(input(), { key: "Enter" });
  expect(onCommit).toHaveBeenCalledWith("deploy");
  expect(onCancel).not.toHaveBeenCalled();
});

test("an emptied field commits, which is how a name is cleared", () => {
  setup();
  fireEvent.change(input(), { target: { value: "" } });
  fireEvent.keyDown(input(), { key: "Enter" });
  expect(onCommit).toHaveBeenCalledWith("");
});

test("Escape cancels without committing", () => {
  setup();
  fireEvent.change(input(), { target: { value: "deploy" } });
  fireEvent.keyDown(input(), { key: "Escape" });
  expect(onCancel).toHaveBeenCalled();
  expect(onCommit).not.toHaveBeenCalled();
});

test("clicking away commits, like every other inline rename in the app", () => {
  setup();
  fireEvent.change(input(), { target: { value: "deploy" } });
  fireEvent.blur(input());
  expect(onCommit).toHaveBeenCalledWith("deploy");
});

test("a cancelled edit does not then commit on the blur it causes", () => {
  setup();
  fireEvent.keyDown(input(), { key: "Escape" });
  fireEvent.blur(input());
  expect(onCommit).not.toHaveBeenCalled();
});

test("keystrokes stay in the editor instead of reaching the tab behind it", () => {
  const onParentKeyDown = vi.fn();
  render(
    <div onKeyDown={onParentKeyDown}>
      <InlineNameEditor value="web-01" onCommit={onCommit} onCancel={onCancel} />
    </div>,
  );
  fireEvent.keyDown(input(), { key: "w" });
  expect(onParentKeyDown).not.toHaveBeenCalled();
});

test("the field refuses more than a label's worth of text", () => {
  setup();
  expect(input().maxLength).toBe(60);
});
