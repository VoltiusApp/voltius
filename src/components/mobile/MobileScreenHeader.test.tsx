import { describe, test, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent, screen } from "@testing-library/react";

vi.mock("@iconify/react", () => ({
  Icon: ({ icon }: { icon: string }) => <i data-icon={icon} />,
}));

import { MobileScreenHeader } from "./MobileScreenHeader";

afterEach(cleanup);

describe("MobileScreenHeader", () => {
  test("keeps the data-mobile-back handle and fires onBack", () => {
    const onBack = vi.fn();
    const { container } = render(<MobileScreenHeader title="Docker" onBack={onBack} />);
    const back = container.querySelector("[data-mobile-back]")!;
    fireEvent.click(back);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  test("renders the subtitle only when there is one", () => {
    const { rerender } = render(<MobileScreenHeader title="Docker" subtitle="prod-1" onBack={() => {}} />);
    expect(screen.getByText("prod-1")).toBeTruthy();

    rerender(<MobileScreenHeader title="Docker" subtitle={null} onBack={() => {}} />);
    expect(screen.queryByText("prod-1")).toBeNull();
  });

  test("renders the right-hand slot after the title", () => {
    const { container } = render(
      <MobileScreenHeader title="Docker" onBack={() => {}}>
        <button data-refresh />
      </MobileScreenHeader>,
    );
    const header = container.querySelector("header")!;
    expect(header.lastElementChild!.hasAttribute("data-refresh")).toBe(true);
  });
});
