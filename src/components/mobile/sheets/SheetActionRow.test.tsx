import { describe, test, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import type { Folder } from "@/types";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock("@iconify/react", () => ({
  Icon: ({ icon }: { icon: string }) => <i data-icon={icon} />,
}));

import { SheetActionRow } from "./SheetActionRow";
import AddChoiceSheet from "./AddChoiceSheet";
import FolderActionsSheet from "./FolderActionsSheet";

afterEach(cleanup);

describe("SheetActionRow", () => {
  test("names its data attribute after the sheet", () => {
    const { container } = render(
      <SheetActionRow attr="host-action" it={{ icon: "lucide:pencil", label: "Edit", slug: "edit", onTap: () => {} }} />,
    );
    expect(container.querySelector("[data-host-action='edit']")).not.toBeNull();
  });

  test("falls back to a slug derived from the label", () => {
    const { container } = render(
      <SheetActionRow attr="host-action" it={{ icon: "lucide:copy", label: "Copy to vault", onTap: () => {} }} />,
    );
    expect(container.querySelector("[data-host-action='copy-to-vault']")).not.toBeNull();
  });

  test("danger rows are tinted, ordinary rows are not", () => {
    const { container: danger } = render(
      <SheetActionRow attr="a" it={{ icon: "i", label: "Delete", danger: true, onTap: () => {} }} />,
    );
    const { container: plain } = render(
      <SheetActionRow attr="a" it={{ icon: "i", label: "Rename", onTap: () => {} }} />,
    );
    expect(danger.querySelector("button")!.style.color).toContain("--t-danger");
    expect(plain.querySelector("button")!.style.color).toContain("--t-text-primary");
  });

  test("renders the icon and fires onTap", () => {
    const onTap = vi.fn();
    const { container } = render(
      <SheetActionRow attr="a" it={{ icon: "lucide:trash-2", label: "Delete", onTap }} />,
    );
    expect(container.querySelector("[data-icon='lucide:trash-2']")).not.toBeNull();
    fireEvent.click(container.querySelector("button")!);
    expect(onTap).toHaveBeenCalledTimes(1);
  });
});

// The sheets below are the two with no store dependencies — enough to prove the
// shared row keeps each sheet's own automation handles and wiring.
describe("sheets using the shared row", () => {
  test("AddChoiceSheet keeps its data-add-choice handles", () => {
    const onNewItem = vi.fn();
    render(
      <AddChoiceSheet
        newItemLabel="New host"
        newItemIcon="lucide:server"
        onNewItem={onNewItem}
        onNewFolder={() => {}}
        onClose={() => {}}
      />,
    );
    const item = document.querySelector("[data-add-choice='item']");
    expect(item).not.toBeNull();
    expect(document.querySelector("[data-add-choice='folder']")).not.toBeNull();
    fireEvent.click(item!);
    expect(onNewItem).toHaveBeenCalledTimes(1);
  });

  test("FolderActionsSheet keeps its data-folder-action handles, delete still tinted", () => {
    const folder: Folder = {
      id: "f1", name: "Prod", object_type: "connection", vault_id: "personal",
      created_at: "", updated_at: "", clocks: {},
    } as Folder;
    render(<FolderActionsSheet folder={folder} onRename={() => {}} onDelete={() => {}} onClose={() => {}} />);
    expect(document.querySelector("[data-folder-action='rename']")).not.toBeNull();
    const del = document.querySelector<HTMLButtonElement>("[data-folder-action='delete']");
    expect(del).not.toBeNull();
    expect(del!.style.color).toContain("--t-danger");
  });
});
