import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import ProxyFields from "./ProxyFields";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));

const modes = [
  { value: "", label: "Inherit (currently: No proxy)" },
  { value: "direct", label: "Direct" },
  { value: "socks5", label: "SOCKS5" },
  { value: "http", label: "HTTP CONNECT" },
];

describe("ProxyFields", () => {
  afterEach(cleanup);

  it("shows endpoint fields only for socks5/http", () => {
    const { rerender } = render(
      <ProxyFields modes={modes} value={{ mode: "" }} onChange={() => {}} password="" passwordSaved={false} onPasswordChange={() => {}} />,
    );
    expect(screen.queryByLabelText(/host/i)).toBeNull();
    rerender(
      <ProxyFields modes={modes} value={{ mode: "socks5" }} onChange={() => {}} password="" passwordSaved={false} onPasswordChange={() => {}} />,
    );
    expect(screen.getByLabelText(/host/i)).toBeTruthy();
    expect((screen.getByLabelText(/port/i) as HTMLInputElement).placeholder).toBe("1080");
    rerender(
      <ProxyFields modes={modes} value={{ mode: "http" }} onChange={() => {}} password="" passwordSaved={false} onPasswordChange={() => {}} />,
    );
    expect((screen.getByLabelText(/port/i) as HTMLInputElement).placeholder).toBe("8080");
  });

  it("flags a custom proxy with no host before it is used", () => {
    const { rerender } = render(
      <ProxyFields modes={modes} value={{ mode: "socks5" }} onChange={() => {}} password="" passwordSaved={false} onPasswordChange={() => {}} />,
    );
    expect(screen.getByRole("alert").textContent).toBe("connections.form.proxy.hostMissing");
    rerender(
      <ProxyFields modes={modes} value={{ mode: "socks5", host: "h" }} onChange={() => {}} password="" passwordSaved={false} onPasswordChange={() => {}} />,
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("rejects an out-of-range port", () => {
    const onChange = vi.fn();
    render(
      <ProxyFields modes={modes} value={{ mode: "socks5", host: "h" }} onChange={onChange} password="" passwordSaved={false} onPasswordChange={() => {}} />,
    );
    fireEvent.change(screen.getByLabelText(/port/i), { target: { value: "70000" } });
    expect(onChange).not.toHaveBeenCalledWith(expect.objectContaining({ port: 70000 }));
    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("accepts an in-range port", () => {
    const onChange = vi.fn();
    render(
      <ProxyFields modes={modes} value={{ mode: "socks5", host: "h" }} onChange={onChange} password="" passwordSaved={false} onPasswordChange={() => {}} />,
    );
    fireEvent.change(screen.getByLabelText(/port/i), { target: { value: "1080" } });
    expect(onChange).toHaveBeenCalledWith({ mode: "socks5", host: "h", port: 1080 });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("never renders a saved password, only a saved marker", () => {
    render(
      <ProxyFields modes={modes} value={{ mode: "socks5", host: "h" }} onChange={() => {}} password="" passwordSaved onPasswordChange={() => {}} />,
    );
    expect((screen.getByLabelText(/password/i) as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText(/password/i) as HTMLInputElement).placeholder).toMatch(/saved/i);
  });

  it("disables every control when disabled", () => {
    render(
      <ProxyFields modes={modes} value={{ mode: "socks5", host: "h" }} onChange={() => {}} password="" passwordSaved={false} onPasswordChange={() => {}} disabled />,
    );
    for (const label of [/host/i, /port/i, /username/i, /password/i]) {
      expect((screen.getByLabelText(label) as HTMLInputElement).disabled).toBe(true);
    }
    expect((screen.getByRole("button", { name: "connections.form.proxy.label" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
