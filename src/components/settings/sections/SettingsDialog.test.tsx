import { describe, test, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent, screen } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({
  Icon: ({ icon }: { icon: string }) => <i data-icon={icon} />,
}));

import { FormButtons, SettingsDialog } from "./shared";

afterEach(cleanup);

describe("SettingsDialog", () => {
  test("closes on the scrim and on the header button, not on the card itself", () => {
    const onClose = vi.fn();
    const { container } = render(
      <SettingsDialog title="Change password" onClose={onClose}>
        <p>body</p>
      </SettingsDialog>,
    );
    const scrim = container.firstElementChild as HTMLElement;
    const card = scrim.firstElementChild as HTMLElement;

    fireEvent.click(card);
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(container.querySelector("[data-icon='lucide:x']")!.parentElement!);
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(scrim);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  test("renders the title and the children", () => {
    render(<SettingsDialog title="Edit email" onClose={() => {}}><p>body</p></SettingsDialog>);
    expect(screen.getByText("Edit email")).toBeTruthy();
    expect(screen.getByText("body")).toBeTruthy();
  });
});

describe("FormButtons", () => {
  test("submit is live and unstyled when submitting is not passed", () => {
    const { container } = render(<FormButtons onCancel={() => {}} submitLabel="Save" />);
    const submit = container.querySelector<HTMLButtonElement>("button[type='submit']")!;
    expect(submit.disabled).toBe(false);
    expect(submit.style.opacity).toBe("");
  });

  test("submitting disables and dims submit, cancel stays clickable", () => {
    const onCancel = vi.fn();
    const { container } = render(<FormButtons onCancel={onCancel} submitLabel="Saving…" submitting />);
    const submit = container.querySelector<HTMLButtonElement>("button[type='submit']")!;
    expect(submit.disabled).toBe(true);
    expect(submit.style.opacity).toBe("0.7");

    fireEvent.click(container.querySelector("button[type='button']")!);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  test("submitting false keeps submit enabled at full opacity", () => {
    const { container } = render(<FormButtons onCancel={() => {}} submitLabel="Save" submitting={false} />);
    const submit = container.querySelector<HTMLButtonElement>("button[type='submit']")!;
    expect(submit.disabled).toBe(false);
    expect(submit.style.opacity).toBe("1");
  });
});
