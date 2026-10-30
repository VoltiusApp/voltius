import { describe, test, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, fireEvent, act } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, o?: Record<string, string>) => (o ? `${key}${JSON.stringify(o)}` : key),
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock("@/services/deviceFiles", () => ({ answerFileRequest: vi.fn(async () => undefined) }));

import { FileAccessRequestModal } from "./FileAccessRequestModal";
import { useDeviceFilesStore, type ApprovalPrompt } from "@/stores/deviceFilesStore";
import { useNotificationStore } from "@/stores/notificationStore";
import { answerFileRequest } from "@/services/deviceFiles";

const prompt = (id: string, over: Partial<ApprovalPrompt> = {}): ApprovalPrompt => ({
  requestId: id,
  deviceKey: `k-${id}`,
  deviceName: `Dev-${id}`,
  platform: "windows",
  route: "lan",
  newDevice: false,
  ...over,
});

const config = (over = {}) => ({
  enabled: true,
  folders: ["/home/me/Downloads", "C:\\Users\\me\\Pictures"],
  readOnly: false,
  allowed: [],
  seenKeys: [],
  ...over,
});

beforeEach(() => {
  vi.mocked(answerFileRequest).mockClear();
  useDeviceFilesStore.setState({ config: config(), pending: [], sessions: [] });
});

afterEach(() => {
  cleanup();
  useDeviceFilesStore.getState().reset();
});

describe("FileAccessRequestModal", () => {
  test("shows_oldest_prompt_with_folder_names", () => {
    useDeviceFilesStore.setState({ pending: [prompt("a"), prompt("b")] });
    render(<FileAccessRequestModal />);
    const text = document.body.textContent ?? "";
    expect(text).toContain("Dev-a");
    expect(text).not.toContain("Dev-b");
    expect(text).toContain("Downloads, Pictures");
    expect(text).not.toContain("home/me");
    expect(text).toContain("layout.deviceFiles.readWrite");
  });

  test("new_device_badge", () => {
    useDeviceFilesStore.setState({ pending: [prompt("a", { newDevice: true })] });
    const { queryByText, rerender } = render(<FileAccessRequestModal />);
    expect(queryByText("layout.deviceFiles.newDevice")).toBeTruthy();
    act(() => useDeviceFilesStore.setState({ pending: [prompt("a")] }));
    rerender(<FileAccessRequestModal />);
    expect(queryByText("layout.deviceFiles.newDevice")).toBeNull();
  });

  test("read_only_copy", () => {
    useDeviceFilesStore.setState({ config: config({ readOnly: true }), pending: [prompt("a")] });
    render(<FileAccessRequestModal />);
    expect(document.body.textContent).toContain("layout.deviceFiles.readOnly");
    expect(document.body.textContent).not.toContain("layout.deviceFiles.readWrite");
  });

  test("escape_denies", () => {
    useDeviceFilesStore.setState({ pending: [prompt("a")] });
    render(<FileAccessRequestModal />);
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(answerFileRequest).toHaveBeenCalledTimes(1);
    expect(answerFileRequest).toHaveBeenCalledWith("a", "deny");
  });

  test("failed_answer_can_be_retried", async () => {
    vi.mocked(answerFileRequest).mockRejectedValueOnce(new Error("boom"));
    useDeviceFilesStore.setState({ pending: [prompt("a")] });
    const { getByText } = render(<FileAccessRequestModal />);
    await act(async () => {
      fireEvent.click(getByText("layout.deviceFiles.once"));
    });
    fireEvent.click(getByText("layout.deviceFiles.once"));
    expect(answerFileRequest).toHaveBeenCalledTimes(2);
  });

  test("answer_advances_to_next", () => {
    useDeviceFilesStore.setState({ pending: [prompt("a"), prompt("b")] });
    const { getByText } = render(<FileAccessRequestModal />);
    fireEvent.click(getByText("layout.deviceFiles.always"));
    expect(answerFileRequest).toHaveBeenCalledWith("a", "always");
    act(() => useDeviceFilesStore.setState({ pending: [prompt("b")] }));
    expect(document.body.textContent).toContain("Dev-b");
    fireEvent.click(getByText("layout.deviceFiles.once"));
    expect(answerFileRequest).toHaveBeenLastCalledWith("b", "once");
  });

  test("closes_when_the_request_ends_unanswered", () => {
    useDeviceFilesStore.setState({ pending: [prompt("a")] });
    render(<FileAccessRequestModal />);
    expect(document.body.textContent).toContain("Dev-a");
    act(() => useDeviceFilesStore.setState({ pending: [] }));
    expect(document.body.textContent).not.toContain("Dev-a");
    expect(answerFileRequest).not.toHaveBeenCalled();
  });

  test("session_start_toasts_once", () => {
    const toasts = () => useNotificationStore.getState().toasts.length;
    useDeviceFilesStore.setState({ sessions: [{ deviceKey: "x", deviceName: "Old", since: "1" }] });
    render(<FileAccessRequestModal />);
    const before = toasts();
    const fresh = { deviceKey: "y", deviceName: "Phone", since: "2" };
    act(() => useDeviceFilesStore.setState({ sessions: [{ deviceKey: "x", deviceName: "Old", since: "1" }, fresh] }));
    expect(toasts()).toBe(before + 1);
    act(() => useDeviceFilesStore.setState({ sessions: [{ deviceKey: "x", deviceName: "Old", since: "1" }, { ...fresh }] }));
    expect(toasts()).toBe(before + 1);
    act(() => useDeviceFilesStore.setState({ sessions: [] }));
    act(() => useDeviceFilesStore.setState({ sessions: [{ ...fresh, since: "3" }] }));
    expect(toasts()).toBe(before + 2);
  });
});
