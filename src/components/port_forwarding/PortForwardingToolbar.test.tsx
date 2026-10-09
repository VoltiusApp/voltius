import { test, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent, screen } from "@testing-library/react";
import { PortForwardingToolbar } from "./PortForwardingToolbar";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/hooks/useToolbarResize", () => ({
  useToolbarResize: () => ({ compact: false, rowRef: { current: null }, leftRef: { current: null }, rightRef: { current: null } }),
}));
vi.mock("@/components/shared/ToolbarViewControls", () => ({ ToolbarViewControls: () => null }));

afterEach(cleanup);

function renderToolbar(onNewRule = vi.fn(), onNewFolder = vi.fn()) {
  render(
    <PortForwardingToolbar
      search="" onSearchChange={() => {}}
      layoutMode="grid" onLayoutModeChange={() => {}}
      sortMode="name-asc" onSortModeChange={() => {}}
      onNewRule={onNewRule} onNewFolder={onNewFolder}
    />,
  );
  return { onNewRule, onNewFolder };
}

test("create menu opens a new rule of the picked tunnel type", () => {
  const { onNewRule } = renderToolbar();
  for (const type of ["local", "remote", "dynamic"] as const) {
    fireEvent.click(screen.getByTitle("common.action.moreOptions"));
    fireEvent.click(screen.getByText(`portForwarding.ruleForm.tunnelTypes.${type}.title`));
    expect(onNewRule).toHaveBeenLastCalledWith(type);
  }
});

test("main button opens a new rule with the default type", () => {
  const { onNewRule } = renderToolbar();
  fireEvent.click(screen.getByText("portForwarding.toolbar.newRule"));
  expect(onNewRule).toHaveBeenCalledWith();
});

test("create menu still offers a new folder", () => {
  const { onNewFolder } = renderToolbar();
  fireEvent.click(screen.getByTitle("common.action.moreOptions"));
  fireEvent.click(screen.getByText("portForwarding.toolbar.newFolder"));
  expect(onNewFolder).toHaveBeenCalledTimes(1);
});
