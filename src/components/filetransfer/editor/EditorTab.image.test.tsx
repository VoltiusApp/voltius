import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const sftp = vi.hoisted(() => ({
  readEditorFile: vi.fn(),
  readEditorImage: vi.fn(),
  writeEditorFile: vi.fn(async () => {}),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@uiw/react-codemirror", () => ({ default: ({ value }: { value: string }) => <pre data-testid="code">{value}</pre> }));
vi.mock("./useCmTheme", () => ({ useCmTheme: () => [] }));
vi.mock("@/components/filetransfer/FilePane", () => ({
  IconBtn: ({ title, onClick }: { title: string; onClick: () => void }) => <button title={title} onClick={onClick} />,
}));
vi.mock("@/components/filetransfer/osDropPipeline", () => ({ downloadToPickedFolder: vi.fn() }));
vi.mock("@/services/saveFile", () => ({ notify: vi.fn() }));
vi.mock("@/utils/clipboard", () => ({ writeClipboardImage: vi.fn() }));
vi.mock("@/services/sftp", async (orig) => ({ ...(await orig<object>()), ...sftp }));

import { EditorTab } from "./EditorTab";
import { useEditorStore, type EditorDoc } from "@/stores/editorStore";

const PNG = { mime: "image/png", bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]) };

function open(path: string): EditorDoc {
  const id = useEditorStore.getState().openDoc({ sftpId: "s1", path, hostLabel: "prod-api", autoSave: false });
  return useEditorStore.getState().tabs.find((t) => t.id === id) as EditorDoc;
}

const ctrlS = () => fireEvent.keyDown(window, { key: "s", ctrlKey: true });

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  URL.createObjectURL = vi.fn(() => "blob:image");
  URL.revokeObjectURL = vi.fn();
  useEditorStore.setState({ tabs: [], activeTabId: null });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("EditorTab with images", () => {
  it("reads an image-named file as an image in one read", async () => {
    sftp.readEditorImage.mockResolvedValue(PNG);
    render(<EditorTab doc={open("/pics/cpu.png")} />);
    expect(await screen.findByRole("img")).toHaveProperty("src", "blob:image");
    expect(sftp.readEditorFile).not.toHaveBeenCalled();
    expect(useEditorStore.getState().tabs[0]).toMatchObject({ image: true });
  });

  it("switches to the image view when the text read finds an image", async () => {
    sftp.readEditorFile.mockRejectedValue({ kind: "image", mime: "image/png", size: 4 });
    sftp.readEditorImage.mockResolvedValue(PNG);
    render(<EditorTab doc={open("/pics/deploy-diagram")} />);
    expect(await screen.findByRole("img")).toBeTruthy();
  });

  it("falls back to text when an image-named file is not an image", async () => {
    sftp.readEditorImage.mockRejectedValue({ kind: "binary" });
    sftp.readEditorFile.mockResolvedValue({ content: "TODO before Friday", size: 18 });
    render(<EditorTab doc={open("/pics/notes.png")} />);
    expect((await screen.findByTestId("code")).textContent).toBe("TODO before Friday");
  });

  it("never saves over an image or a binary file", async () => {
    sftp.readEditorImage.mockResolvedValue(PNG);
    render(<EditorTab doc={open("/pics/cpu.png")} />);
    await screen.findByRole("img");
    ctrlS();
    cleanup();

    sftp.readEditorFile.mockRejectedValue({ kind: "binary" });
    render(<EditorTab doc={open("/bin/tool")} />);
    await screen.findByText("fileTransfer.editor.tab.error.binary");
    ctrlS();
    await act(async () => {});
    expect(sftp.writeEditorFile).not.toHaveBeenCalled();
  });

  it("offers Preview anyway for an image above the preview cap", async () => {
    sftp.readEditorImage.mockRejectedValueOnce({ kind: "too_large", size: 40 << 20, limit: 25 << 20 }).mockResolvedValueOnce(PNG);
    render(<EditorTab doc={open("/pics/scan.png")} />);
    fireEvent.click(await screen.findByText("fileTransfer.editor.image.previewAnyway"));
    expect(useEditorStore.getState().tabs[0]).toMatchObject({ image: true });
    expect(await screen.findByRole("img")).toBeTruthy();
    expect(sftp.readEditorImage).toHaveBeenLastCalledWith("s1", "/pics/scan.png", 256 << 20);
  });

  it("counts every Ctrl+wheel tick even before the view re-renders", async () => {
    sftp.readEditorImage.mockResolvedValue(PNG);
    render(<EditorTab doc={open("/pics/cpu.png")} />);
    const viewport = (await screen.findByRole("img")).closest(".overflow-auto")!;
    act(() => {
      for (let i = 0; i < 4; i++) viewport.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, ctrlKey: true, cancelable: true }));
    });
    expect(screen.getByTitle("fileTransfer.editor.image.toggleFit").textContent).toBe("244%");
  });
});
