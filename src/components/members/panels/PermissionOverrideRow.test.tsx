import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, o?: { roles?: string }) => (o?.roles ? `${k} ${o.roles}` : k),
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

import { PERM_BITS } from "@/services/permissions";
import {
  PermissionOverrideRow, overrideStateOf, applyOverrideState,
} from "./PermissionOverrideRow";

afterEach(cleanup);

describe("overrideStateOf", () => {
  it("reads inherit when the bit is in neither mask", () => {
    expect(overrideStateOf("CONNECT", 0, 0)).toBe("inherit");
  });
  it("reads allow when the bit is in the allow mask", () => {
    expect(overrideStateOf("CONNECT", PERM_BITS.CONNECT, 0)).toBe("allow");
  });
  it("reads deny when the bit is in the deny mask", () => {
    expect(overrideStateOf("CONNECT", 0, PERM_BITS.CONNECT)).toBe("deny");
  });
  it("prefers deny when the bit is in both", () => {
    expect(overrideStateOf("CONNECT", PERM_BITS.CONNECT, PERM_BITS.CONNECT)).toBe("deny");
  });
});

describe("applyOverrideState", () => {
  it("moves a bit from allow to deny without leaving it in both", () => {
    expect(applyOverrideState("CONNECT", PERM_BITS.CONNECT, 0, "deny")).toEqual({
      allow: 0, deny: PERM_BITS.CONNECT,
    });
  });
  it("clears the bit from both masks on inherit", () => {
    expect(applyOverrideState("CONNECT", 0, PERM_BITS.CONNECT, "inherit")).toEqual({
      allow: 0, deny: 0,
    });
  });
  it("leaves other bits untouched", () => {
    const { allow, deny } = applyOverrideState("CONNECT", PERM_BITS.EDIT_KEYS, PERM_BITS.VIEW_SECRETS, "allow");
    expect(allow).toBe(PERM_BITS.EDIT_KEYS | PERM_BITS.CONNECT);
    expect(deny).toBe(PERM_BITS.VIEW_SECRETS);
  });
});

describe("PermissionOverrideRow", () => {
  const base = {
    permission: "CONNECT" as const,
    state: "inherit" as const,
    inheritedFrom: ["editor"],
    inheritedGrants: true,
    disabled: false,
  };

  it("names the roles the bit is inherited from", () => {
    render(<PermissionOverrideRow {...base} onChange={vi.fn()} />);
    expect(screen.getByText(/editor/)).toBeTruthy();
  });

  it("emits the chosen state", () => {
    const onChange = vi.fn();
    render(<PermissionOverrideRow {...base} onChange={onChange} />);
    fireEvent.click(screen.getByRole("radio", { name: /deny/i }));
    expect(onChange).toHaveBeenCalledWith("deny");
  });

  it("does not emit while disabled", () => {
    const onChange = vi.fn();
    render(<PermissionOverrideRow {...base} disabled onChange={onChange} />);
    fireEvent.click(screen.getByRole("radio", { name: /deny/i }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
