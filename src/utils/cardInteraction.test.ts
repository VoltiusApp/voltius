import { describe, expect, it, vi } from "vitest";
import { exceptItems, folderAwareKeys, selectFollowing } from "./cardInteraction";

const click = (mods: Partial<{ ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }> = {}) =>
  ({ ctrlKey: false, metaKey: false, shiftKey: false, ...mods });

describe("selectFollowing", () => {
  it("always selects, and follows only on a plain click while the panel is open", () => {
    const select = vi.fn();
    const follow = vi.fn();
    selectFollowing(select, true, follow)("a", click());
    selectFollowing(select, true, follow)("a", click({ shiftKey: true }));
    selectFollowing(select, false, follow)("a", click());
    expect(select).toHaveBeenCalledTimes(3);
    expect(follow).toHaveBeenCalledTimes(1);
  });
});

describe("folderAwareKeys", () => {
  it("opens or edits a folder, and hands every other id to the item handlers", () => {
    const folder = { open: vi.fn(), edit: vi.fn() };
    const item = { enter: vi.fn(), edit: vi.fn() };
    const keys = folderAwareKeys([{ id: "f1" }], folder, item);
    keys.onEnter("f1");
    keys.onEdit("f1");
    keys.onEnter("h1");
    keys.onEdit("h1");
    expect(folder.open).toHaveBeenCalledWith({ id: "f1" });
    expect(folder.edit).toHaveBeenCalledWith({ id: "f1" });
    expect(item.enter).toHaveBeenCalledWith("h1");
    expect(item.edit).toHaveBeenCalledWith("h1");
  });
});

describe("exceptItems", () => {
  it("drops the excluded items and keeps the order of the rest", () => {
    expect(exceptItems([{ id: "a" }, { id: "b" }, { id: "c" }], [{ id: "b" }])).toEqual([{ id: "a" }, { id: "c" }]);
  });
});
