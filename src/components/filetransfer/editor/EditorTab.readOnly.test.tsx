import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

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
  default: ({ value, readOnly }: { value: string; readOnly?: boolean }) => {
    cm.readOnly = readOnly;
    return <pre data-testid="code">{value}</pre>;
  },
}));
vi.mock("./useCmTheme", () => ({ useCmTheme: () => [] }));
vi.mock("@/components/filetransfer/FilePane", () => ({
  IconBtn: ({ title, onClick, disabled }: { title: string; onClick: () => void; disabled?: boolean }) => (
    <button title={title} onClick={onClick} disabled={disabled} />
  ),
}));
vi.mock("@/services/sftp", async (orig) => ({ ...(await orig<object>()), ...sftp }));

import { EditorTab } from "./EditorTab";
import { useEditorStore, type EditorDoc } from "@/stores/editorStore";

function open(readOnly: boolean): EditorDoc {
  const id = useEditorStore.getState().openDoc({ sftpId: "s1", path: "/a.txt", hostLabel: "Work PC", autoSave: true, readOnly });
  return useEditorStore.getState().tabs.find((t) => t.id === id) as EditorDoc;
}

beforeEach(() => useEditorStore.setState({ tabs: [], activeTabId: null }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it("a read-only document cannot be saved or edited", async () => {
  render(<EditorTab doc={open(true)} />);
  await screen.findByTestId("code");
  expect(cm.readOnly).toBe(true);
  const save = screen.getAllByTitle("fileTransfer.myDevices.readOnlyShare").find((el) => el.tagName === "BUTTON") as HTMLButtonElement;
  expect(save.disabled).toBe(true);
  fireEvent.keyDown(window, { key: "s", ctrlKey: true });
  expect(sftp.writeEditorFile).not.toHaveBeenCalled();
});

it("a writable document still saves", async () => {
  render(<EditorTab doc={open(false)} />);
  await screen.findByTestId("code");
  expect(cm.readOnly).toBe(false);
  fireEvent.keyDown(window, { key: "s", ctrlKey: true });
  expect(sftp.writeEditorFile).toHaveBeenCalled();
});
