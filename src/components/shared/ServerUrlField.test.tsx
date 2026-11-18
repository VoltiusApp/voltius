import { afterEach, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, string>) =>
      vars ? `${key}:${Object.values(vars).join(",")}` : key,
  }),
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));

import { ServerUrlField } from "./ServerUrlField";
import { DEFAULT_SERVER_URL } from "@/utils/serverInstance";

afterEach(cleanup);

const field = () => screen.queryByPlaceholderText(DEFAULT_SERVER_URL);

test("stays out of the way on the official cloud", () => {
  render(<ServerUrlField value={DEFAULT_SERVER_URL} onChange={vi.fn()} inputClassName="i" />);

  expect(screen.getByText(/layout.auth.customServerUrl/)).toBeTruthy();
  expect(field()).toBeNull();
});

/**
 * A collapsed field that silently reads api.voltius.app is how signing in to a
 * self-hosted instance turns into registering on the official cloud instead.
 */
test("opens and names the host when the account is not on the official cloud", () => {
  render(
    <ServerUrlField value="https://stackdome.example.tld" onChange={vi.fn()} inputClassName="i" />,
  );

  expect(screen.getByRole("button").textContent).toContain(
    "layout.auth.serverNamed:stackdome.example.tld",
  );
  expect(field()).toBeTruthy();
});

test("can still be opened by hand on the official cloud", async () => {
  render(<ServerUrlField value={DEFAULT_SERVER_URL} onChange={vi.fn()} inputClassName="i" />);

  await userEvent.click(screen.getByText(/layout.auth.customServerUrl/));
  expect(field()).toBeTruthy();
});

test("locked shows the full host on its own line and the managed note beneath it", () => {
  const url = "https://voltius.acme.example";
  const { container } = render(<ServerUrlField value={url} onChange={vi.fn()} inputClassName="i" locked />);
  const [host, note] = [...(container.firstElementChild as HTMLElement).children];

  expect(host.textContent).toBe("layout.auth.serverNamed:voltius.acme.example");
  expect(host.getAttribute("title")).toBe(url);
  expect(note.textContent).toBe("common.policy.managed");
  expect(field()).toBeNull();
});
