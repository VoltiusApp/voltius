// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { columnGrid, DEFAULT_COLUMN_WIDTHS } from "./SFTPTypes";

const none = { size: false, modified: false, permissions: false };
const all = { size: true, modified: true, permissions: true };

describe("columnGrid", () => {
  it("lets a name-only grid shrink to its container", () => {
    expect(columnGrid(true, none, DEFAULT_COLUMN_WIDTHS)).toEqual({ template: "minmax(0, 1fr)", minWidth: 0 });
  });

  it("keeps the name width as a floor when data columns sit to its right", () => {
    const { template, minWidth } = columnGrid(true, all, DEFAULT_COLUMN_WIDTHS);
    expect(template).toBe("minmax(260px, 1fr) 88px 128px 88px");
    expect(minWidth).toBe(260 + 88 + 128 + 88 + 3 * 8);
  });
});
