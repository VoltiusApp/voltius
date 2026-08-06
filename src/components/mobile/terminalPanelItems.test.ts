import { describe, test, expect, vi } from "vitest";
import { terminalPanelItems } from "./terminalPanelItems";
import type { TFunction } from "i18next";

const t = ((k: string) => k) as unknown as TFunction;
const nav = { push: vi.fn(), openSheet: vi.fn() };

const base = { activeSessionId: "s1", connectionIdOfActive: "c1", nav };

describe("terminalPanelItems", () => {
  test("appends contributed actions after the built-ins", () => {
    const onClick = vi.fn();
    const items = terminalPanelItems(
      { ...base, contributed: [{ label: "Ask AI", icon: "lucide:sparkles", onClick }] },
      t,
    );
    const builtIns = terminalPanelItems(base, t);
    expect(items).toHaveLength(builtIns.length + 1);
    expect(items.slice(0, builtIns.length).map((i) => i.key)).toEqual(builtIns.map((i) => i.key));

    const last = items[items.length - 1];
    expect(last.label).toBe("Ask AI");
    expect(last.icon).toBe("lucide:sparkles");
    last.onTap();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  test("an iconless contribution still renders with a fallback icon", () => {
    const items = terminalPanelItems({ ...base, contributed: [{ label: "X", onClick: vi.fn() }] }, t);
    expect(items[items.length - 1].icon).toBe("lucide:puzzle");
  });

  test("no contributions leaves the built-in list untouched", () => {
    const keys = (c?: never[]) => terminalPanelItems({ ...base, contributed: c }, t).map((i) => i.key);
    expect(keys([])).toEqual(keys());
  });
});
