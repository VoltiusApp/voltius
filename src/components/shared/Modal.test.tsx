// @vitest-environment jsdom
import { afterEach, expect, test } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Modal } from "@/components/shared/Modal";

afterEach(cleanup);

function outsideField() {
  const el = document.createElement("textarea");
  document.body.appendChild(el);
  el.focus();
  return el;
}

test("opening takes focus from behind the modal and closing gives it back", () => {
  const behind = outsideField();
  const { unmount } = render(<Modal onClose={() => {}}><button>inside</button></Modal>);
  expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(true);
  unmount();
  expect(document.activeElement).toBe(behind);
  behind.remove();
});

test("an autofocused child keeps focus", () => {
  const behind = outsideField();
  render(<Modal onClose={() => {}}><input autoFocus aria-label="name" /></Modal>);
  expect(document.activeElement).toBe(screen.getByLabelText("name"));
  behind.remove();
});
