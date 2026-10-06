// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { migrateSftpSettings } from "./sftpSettingsStore";
import { DEFAULT_COLUMN_WIDTHS } from "@/components/filetransfer/SFTPTypes";

describe("migrateSftpSettings", () => {
  it("widens a size column still at the old 72px default", () => {
    const out = migrateSftpSettings({ columnWidths: { name: 300, size: 72, modified: 128, permissions: 88 } }, 0);
    expect(out).toEqual({ columnWidths: { name: 300, size: DEFAULT_COLUMN_WIDTHS.size, modified: 128, permissions: 88 } });
  });

  it("keeps a size column the user resized", () => {
    const widths = { name: 260, size: 64, modified: 128, permissions: 88 };
    expect(migrateSftpSettings({ columnWidths: widths }, 0)).toEqual({ columnWidths: widths });
  });

  it("leaves already-migrated and empty state alone", () => {
    const widths = { name: 260, size: 72, modified: 128, permissions: 88 };
    expect(migrateSftpSettings({ columnWidths: widths }, 1)).toEqual({ columnWidths: widths });
    expect(migrateSftpSettings(undefined, 0)).toEqual({});
  });
});
