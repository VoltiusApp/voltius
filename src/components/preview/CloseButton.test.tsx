import { test, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import i18n from "@/i18n";
import { CloseButton } from "./CloseButton";

afterEach(cleanup);

test("labels_the_button_with_a_translated_close", async () => {
  await i18n.changeLanguage("en");
  render(<CloseButton testId="x" onClick={() => {}} />);
  expect(screen.getByTestId("x").getAttribute("aria-label")).toBe("Close");
  expect(screen.getByTestId("x").title).toBe("Close");
});
