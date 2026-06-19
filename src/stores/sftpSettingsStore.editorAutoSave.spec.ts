import { describe, it, expect, beforeEach } from "vitest";
import { useSftpSettingsStore } from "./sftpSettingsStore";

describe("sftp settings — editor", () => {
  beforeEach(() => {
    useSftpSettingsStore.setState({
      editorAutoSave: false,
      editorMaxBytes: 5 * 1024 * 1024,
    });
  });

  it("defaults", () => {
    const s = useSftpSettingsStore.getState();
    expect(s.editorAutoSave).toBe(false);
    expect(s.editorMaxBytes).toBe(5 * 1024 * 1024);
  });
  it("setters update state", () => {
    useSftpSettingsStore.getState().setEditorAutoSave(true);
    expect(useSftpSettingsStore.getState().editorAutoSave).toBe(true);
    useSftpSettingsStore.getState().setEditorMaxBytes(1000);
    expect(useSftpSettingsStore.getState().editorMaxBytes).toBe(1000);
  });
});
