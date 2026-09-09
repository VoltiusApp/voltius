import { test, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock("@iconify/react", () => ({
  Icon: ({ icon }: { icon: string }) => <span data-testid="icon">{icon}</span>,
}));

import { ConfirmModal } from "./ConfirmModal";

afterEach(cleanup);

test("defaults to the danger tone", () => {
  render(<ConfirmModal title="Delete" message="gone" onConfirm={vi.fn()} onCancel={vi.fn()} />);
  expect(screen.getByTestId("icon").textContent).toBe("lucide:triangle-alert");
  expect(screen.getByText("common.action.confirm").className).toContain("btn-danger");
});

test("the warning tone is visually distinct from danger", () => {
  render(
    <ConfirmModal tone="warning" title="Make private" message="reversible"
      onConfirm={vi.fn()} onCancel={vi.fn()} />,
  );
  expect(screen.getByText("common.action.confirm").className).not.toContain("btn-danger");
  expect(screen.getByText("common.action.confirm").className).toContain("btn-warning");
});
