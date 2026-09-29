import { expect, test, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

import { TriStateToggle } from "./TriStateToggle";

afterEach(cleanup);

test("three radios, the active one checked, D10 outline classes", () => {
  render(<TriStateToggle value="allow" onChange={() => {}} label="Connect" />);
  const group = screen.getByRole("radiogroup", { name: "Connect" });
  expect(group.className).toContain("bg-(--t-bg-base)");
  expect(group.className).toContain("border-(--t-border-hover)");
  expect(group.className).toContain("divide-x");
  const radios = screen.getAllByRole("radio");
  expect(radios.map((r) => r.getAttribute("aria-checked"))).toEqual(["false", "false", "true"]);
});

test("clicking reports the next state; disabled reports nothing", () => {
  const onChange = vi.fn();
  const { rerender } = render(<TriStateToggle value="inherit" onChange={onChange} label="x" />);
  fireEvent.click(screen.getByRole("radio", { name: "members.permissions.state.deny" }));
  expect(onChange).toHaveBeenCalledWith("deny");
  rerender(<TriStateToggle value="inherit" onChange={onChange} label="x" disabled />);
  fireEvent.click(screen.getByRole("radio", { name: "members.permissions.state.allow" }));
  expect(onChange).toHaveBeenCalledTimes(1);
});
