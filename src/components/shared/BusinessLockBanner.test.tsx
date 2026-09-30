import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({ lock: { locked: true, isOwner: true }, checkout: vi.fn(async () => true) }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/hooks/useBusinessLock", () => ({ useBusinessLock: () => h.lock }));
vi.mock("@/services/billingCheckout", () => ({ openBillingCheckout: h.checkout }));

import { BusinessLockBanner } from "./BusinessLockBanner";

beforeEach(() => { h.lock = { locked: true, isOwner: true }; h.checkout.mockClear(); });
afterEach(() => cleanup());

test("renders nothing when the team has Business", () => {
  h.lock = { locked: false, isOwner: true };
  const { container } = render(<BusinessLockBanner teamId="t1" />);
  expect(container.firstChild).toBeNull();
});

test("the owner gets a Business checkout button", () => {
  render(<BusinessLockBanner teamId="t1" />);
  fireEvent.click(screen.getByText("shared.businessLock.upgrade"));
  expect(h.checkout).toHaveBeenCalledWith("business");
});

test("anyone else is told only the owner can upgrade", () => {
  h.lock = { locked: true, isOwner: false };
  render(<BusinessLockBanner teamId="t1" />);
  expect(screen.getByText("shared.businessLock.ownerOnly")).toBeTruthy();
  expect(screen.queryByText("shared.businessLock.upgrade")).toBeNull();
});

test("Remove rules needs a second click", async () => {
  const onClear = vi.fn(async () => {});
  render(<BusinessLockBanner teamId="t1" onClear={onClear} />);
  fireEvent.click(screen.getByText("shared.businessLock.clear"));
  expect(onClear).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("shared.businessLock.confirmClear"));
  await waitFor(() => expect(onClear).toHaveBeenCalledTimes(1));
});

test("no Remove rules button without onClear", () => {
  render(<BusinessLockBanner teamId="t1" />);
  expect(screen.queryByText("shared.businessLock.clear")).toBeNull();
});
