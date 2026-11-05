// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string, o?: { host?: string }) => (o?.host ? `${k}:${o.host}` : k) }),
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));

import { ServerUrlField } from "./ServerUrlField";

afterEach(cleanup);

describe("ServerUrlField locked", () => {
  it("shows the full host on its own line and the managed note beneath it", () => {
    const url = "https://voltius.acme.example";
    const { container } = render(<ServerUrlField value={url} onChange={() => {}} inputClassName="" locked />);
    const [host, note] = [...(container.firstElementChild as HTMLElement).children];
    expect(host.textContent).toBe("layout.auth.serverNamed:voltius.acme.example");
    expect(host.getAttribute("title")).toBe(url);
    expect(note.textContent).toBe("common.policy.managed");
    expect(container.querySelector("input")).toBeNull();
  });
});
