import { test, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock("@iconify/react", () => ({ Icon: () => null }));

import { BaseCard } from "./BaseCard";
import { CardMenuButton } from "./CardActionButton";

afterEach(cleanup);

test("the overflow button selects the card and opens its context menu", () => {
  const onClick = vi.fn();
  const onEdit = vi.fn();
  render(
    <BaseCard onClick={onClick} contextMenuItems={[{ label: "Edit", icon: "lucide:pencil", onClick: onEdit }]}>
      <CardMenuButton />
    </BaseCard>,
  );
  fireEvent.click(screen.getByLabelText("common.action.moreOptions"));
  expect(onClick).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByText("Edit"));
  expect(onEdit).toHaveBeenCalledTimes(1);
});

test("a card without menu items renders no overflow button", () => {
  render(<BaseCard onClick={() => {}}><CardMenuButton /></BaseCard>);
  expect(screen.queryByLabelText("common.action.moreOptions")).toBeNull();
});
