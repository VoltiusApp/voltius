import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const sftp = vi.hoisted(() => ({
  readEditorFile: vi.fn(async () => ({ content: "hello" })),
  writeEditorFile: vi.fn(async () => {}),
}));
const cm = vi.hoisted(() => ({ readOnly: undefined as boolean | undefined }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@uiw/react-codemirror", () => ({
  default: ({ value, readOnly, onChange }: { value: string; readOnly?: boolean; onChange: (v: string) => void }) => {
    cm.readOnly = readOnly;
    return <textarea data-testid="code" value={value} onChange={(e) => onChange(e.target.value)} />;
  },
}));
vi.mock("@/components/filetransfer/editor/useCmTheme", () => ({ useCmTheme: () => [] }));
vi.mock("@/services/sftp", async (orig) => ({ ...(await orig<object>()), ...sftp }));

import MobileEditorScreen from "./MobileEditorScreen";
import { useEditorStore, type EditorDoc } from "@/stores/editorStore";

function Harness() {
  const doc = useEditorStore((s) => s.tabs.find((t): t is EditorDoc => t.kind === "file" && t.id === s.activeTabId));
  return doc ? <MobileEditorScreen doc={doc} active /> : <span data-testid="closed" />;
}

const open = (opts: { autoSave?: boolean; readOnly?: boolean } = {}) =>
  useEditorStore.getState().openDoc({ sftpId: "s1", path: "/etc/app/config.yml", hostLabel: "box", autoSave: opts.autoSave ?? false, readOnly: opts.readOnly });

const typeInto = async (text: string) => fireEvent.change(await screen.findByTestId("code"), { target: { value: text } });
const saveButton = () => document.querySelector("[data-mobile-editor-save]") as HTMLButtonElement | null;
const back = () => fireEvent.click(document.querySelector("[data-mobile-back]")!);

beforeEach(() => useEditorStore.setState({ tabs: [], activeTabId: null }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it("shows the file name and folder, and saves an edit", async () => {
  open();
  render(<Harness />);
  expect(screen.getByText("config.yml")).toBeTruthy();
  expect(screen.getByText("box · /etc/app")).toBeTruthy();
  await typeInto("hello world");
  expect(saveButton()!.disabled).toBe(false);
  fireEvent.click(saveButton()!);
  await waitFor(() => expect(sftp.writeEditorFile).toHaveBeenCalledWith("s1", "/etc/app/config.yml", "hello world"));
  await waitFor(() => expect(saveButton()!.disabled).toBe(true));
});

it("Back with unsaved changes asks first; Discard closes without writing", async () => {
  open();
  render(<Harness />);
  await typeInto("changed");
  back();
  fireEvent.click(await screen.findByText("fileTransfer.editor.tabStrip.discard"));
  expect(screen.getByTestId("closed")).toBeTruthy();
  expect(sftp.writeEditorFile).not.toHaveBeenCalled();
});

it("Back with auto-save on saves the pending edit, then closes", async () => {
  open({ autoSave: true });
  render(<Harness />);
  await typeInto("changed");
  await act(async () => back());
  await screen.findByTestId("closed");
  expect(sftp.writeEditorFile).toHaveBeenCalledWith("s1", "/etc/app/config.yml", "changed");
});

it("Back without changes closes at once", async () => {
  open();
  render(<Harness />);
  await screen.findByTestId("code");
  back();
  expect(screen.getByTestId("closed")).toBeTruthy();
});

it("a read-only file opens for reading only", async () => {
  open({ readOnly: true });
  render(<Harness />);
  await screen.findByTestId("code");
  expect(cm.readOnly).toBe(true);
  expect(saveButton()).toBeNull();
});
