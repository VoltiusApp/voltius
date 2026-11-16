// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { makeRole } from "@/test/team";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock("@iconify/react", () => ({ Icon: ({ icon }: { icon: string }) => <i data-icon={icon} /> }));

import RolePickerSheet from "./RolePickerSheet";

const EDITOR = makeRole("r-editor", 0, { name: "Deployers", position: 1 });
const VIEWER = makeRole("r-viewer", 0, { name: "Viewers", position: 2 });
const row = (id: string) => document.querySelector<HTMLButtonElement>(`[data-role-pick='${id}']`)!;

afterEach(cleanup);

describe("RolePickerSheet", () => {
  test("pick mode fires once and closes", () => {
    const onPick = vi.fn();
    const onClose = vi.fn();
    render(<RolePickerSheet title="Pick" roles={[EDITOR, VIEWER]} mode="pick" onPick={onPick} onClose={onClose} />);
    fireEvent.click(row("r-viewer"));
    expect(onPick).toHaveBeenCalledWith(VIEWER);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("role picker toggle mode keeps the sheet open and shows checks", () => {
    const onPick = vi.fn();
    const onClose = vi.fn();
    render(<RolePickerSheet title="Roles" roles={[EDITOR, VIEWER]} mode="toggle" selectedIds={["r-editor"]} onPick={onPick} onClose={onClose} />);
    expect(row("r-editor").getAttribute("aria-checked")).toBe("true");
    expect(row("r-editor").querySelector("[data-icon='lucide:check']")).not.toBeNull();
    expect(row("r-viewer").getAttribute("aria-checked")).toBe("false");
    expect(row("r-viewer").querySelector("[data-icon='lucide:check']")).toBeNull();
    fireEvent.click(row("r-viewer"));
    expect(onPick).toHaveBeenCalledWith(VIEWER);
    expect(onClose).not.toHaveBeenCalled();
  });

  test("a role with a disabled reason is greyed and shows the reason", () => {
    const onPick = vi.fn();
    render(<RolePickerSheet title="Roles" roles={[EDITOR, VIEWER]} mode="toggle"
      disabledReason={(r) => (r.id === "r-editor" ? "Not yours to give" : null)} onPick={onPick} onClose={() => {}} />);
    expect(row("r-editor").disabled).toBe(true);
    expect(row("r-editor").textContent).toContain("Not yours to give");
    fireEvent.click(row("r-editor"));
    expect(onPick).not.toHaveBeenCalled();
  });

  test("the busy role is disabled while its change is in flight", () => {
    const onPick = vi.fn();
    render(<RolePickerSheet title="Roles" roles={[EDITOR, VIEWER]} mode="toggle" busyId="r-viewer" onPick={onPick} onClose={() => {}} />);
    expect(row("r-viewer").disabled).toBe(true);
    expect(row("r-viewer").getAttribute("aria-busy")).toBe("true");
    expect(row("r-editor").disabled).toBe(false);
    fireEvent.click(row("r-viewer"));
    expect(onPick).not.toHaveBeenCalled();
  });
});
