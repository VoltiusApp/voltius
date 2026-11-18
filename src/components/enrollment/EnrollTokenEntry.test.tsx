import { test, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));

import { EnrollTokenEntry } from "./EnrollTokenEntry";
import { buildEnrollmentToken, parseEnrollmentToken } from "@/services/enrollment/enrollmentToken";
import { buildDeepLink } from "@/services/deepLinkUrl";

const TOKEN = buildEnrollmentToken("https://voltius.acme.com", "a".repeat(32), "s".repeat(43));

afterEach(cleanup);

function paste(text: string) {
  const onToken = vi.fn();
  render(<EnrollTokenEntry onToken={onToken} />);
  fireEvent.click(screen.getByText("layout.enroll.tokenEntry.toggle"));
  fireEvent.change(screen.getByPlaceholderText("layout.enroll.tokenEntry.placeholder"), { target: { value: text } });
  fireEvent.submit(document.querySelector("form")!);
  return onToken;
}

test.each([
  ["a bare token", TOKEN],
  ["its https link", buildDeepLink({ route: "enroll", token: TOKEN })],
  ["its voltius:// link", buildDeepLink({ route: "enroll", token: TOKEN }, "scheme")],
])("accepts %s", (_, text) => {
  expect(paste(text)).toHaveBeenCalledWith(parseEnrollmentToken(TOKEN));
});

test("refuses anything else", () => {
  expect(paste("https://voltius.app/open#join?s=x")).not.toHaveBeenCalled();
  expect(screen.getByText("layout.enroll.tokenEntry.invalid")).toBeTruthy();
});

test("Continue stays disabled and quiet until something is typed", () => {
  render(<EnrollTokenEntry onToken={vi.fn()} />);
  fireEvent.click(screen.getByText("layout.enroll.tokenEntry.toggle"));
  const continueBtn = () => screen.getByText("layout.enroll.continue").closest("button")!;
  expect(continueBtn().disabled).toBe(true);
  fireEvent.change(screen.getByPlaceholderText("layout.enroll.tokenEntry.placeholder"), { target: { value: "   " } });
  expect(continueBtn().disabled).toBe(true);
  expect(screen.queryByText("layout.enroll.tokenEntry.invalid")).toBeNull();
  fireEvent.change(screen.getByPlaceholderText("layout.enroll.tokenEntry.placeholder"), { target: { value: "x" } });
  expect(continueBtn().disabled).toBe(false);
});
