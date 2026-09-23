import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ invoke: vi.fn(), save: vi.fn(), addToast: vi.fn(), mobile: false }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: h.invoke }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: h.save }));
vi.mock("@/stores/notificationStore", () => ({ useNotificationStore: { getState: () => ({ addToast: h.addToast }) } }));
vi.mock("@/utils/platform", () => ({ isMobileShell: () => h.mobile }));

import { saveTextFile } from "./saveFile";

describe("saveTextFile", () => {
  beforeEach(() => {
    h.invoke.mockReset();
    h.save.mockReset();
    h.addToast.mockReset();
    h.mobile = false;
  });

  it("writes to the chosen path and confirms with a success toast", async () => {
    h.save.mockResolvedValue("/home/u/voltius-export.json");
    h.invoke.mockResolvedValue(undefined);

    expect(await saveTextFile("voltius-export.json", "{}")).toBe(true);

    expect(h.save).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: "voltius-export.json" }));
    expect(h.invoke).toHaveBeenCalledWith("fs_write_file", { path: "/home/u/voltius-export.json", content: "{}" });
    expect(h.addToast).toHaveBeenCalledWith(expect.objectContaining({
      severity: "success",
      message: expect.stringContaining("/home/u/voltius-export.json"),
    }));
  });

  it("writes nothing and stays quiet when the dialog is cancelled", async () => {
    h.save.mockResolvedValue(null);

    expect(await saveTextFile("a.csv", "x")).toBe(false);

    expect(h.invoke).not.toHaveBeenCalled();
    expect(h.addToast).not.toHaveBeenCalled();
  });

  it("reports a failed write instead of pretending it saved", async () => {
    h.save.mockResolvedValue("/ro/a.json");
    h.invoke.mockRejectedValue("Permission denied (os error 13)");

    expect(await saveTextFile("a.json", "x")).toBe(false);

    expect(h.addToast).toHaveBeenCalledWith(expect.objectContaining({
      severity: "error",
      message: expect.stringContaining("Permission denied"),
    }));
  });

  it("falls back to a browser download on the mobile shell", async () => {
    h.mobile = true;
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();

    await saveTextFile("a.json", "x");

    expect(click).toHaveBeenCalled();
    expect(h.save).not.toHaveBeenCalled();
  });
});
