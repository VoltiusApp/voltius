import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({ lock: { locked: true, isOwner: true as boolean | null }, checkout: vi.fn(async () => true) }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/hooks/useBusinessLock", () => ({ useBusinessLock: () => h.lock }));
vi.mock("@/services/billingCheckout", () => ({ openBillingCheckout: h.checkout }));

import { BusinessLapseNotice, BusinessLockLine } from "./BusinessLockBanner";

beforeEach(() => { h.lock = { locked: true, isOwner: true }; h.checkout.mockClear(); });
afterEach(() => cleanup());

const notice = (onRemove?: () => Promise<void>) =>
  render(<BusinessLapseNotice teamId="t1" message="lapsed" removeLabel="remove" onRemove={onRemove} />);

test("nothing renders when the team has Business", () => {
  h.lock = { locked: false, isOwner: true };
  expect(notice().container.firstChild).toBeNull();
  cleanup();
  expect(render(<BusinessLockLine teamId="t1" label="line" />).container.firstChild).toBeNull();
});

test("the notice shows its message and the owner gets a Business checkout", () => {
  notice();
  expect(screen.getByText("lapsed")).toBeTruthy();
  fireEvent.click(screen.getByText("shared.businessLock.upgrade"));
  expect(h.checkout).toHaveBeenCalledWith("business");
});

test("anyone else is told only the owner can upgrade", () => {
  h.lock = { locked: true, isOwner: false };
  notice();
  expect(screen.getByText("shared.businessLock.ownerOnly")).toBeTruthy();
  expect(screen.queryByText("shared.businessLock.upgrade")).toBeNull();
});

test("while the user id is unknown no upgrade action shows", () => {
  h.lock = { locked: true, isOwner: null };
  notice();
  expect(screen.queryByText("shared.businessLock.ownerOnly")).toBeNull();
  expect(screen.queryByText("shared.businessLock.upgrade")).toBeNull();
});

test("Remove needs a second click", async () => {
  const onRemove = vi.fn(async () => {});
  notice(onRemove);
  fireEvent.click(screen.getByText("remove"));
  expect(onRemove).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("shared.businessLock.confirmClear"));
  await waitFor(() => expect(onRemove).toHaveBeenCalledTimes(1));
});

test("no Remove without onRemove", () => {
  notice();
  expect(screen.queryByText("remove")).toBeNull();
});

test("the line is one sentence with an upgrade link for the owner only", () => {
  render(<BusinessLockLine teamId="t1" label="line" />);
  expect(screen.getByText("line")).toBeTruthy();
  fireEvent.click(screen.getByText("shared.businessLock.upgrade"));
  expect(h.checkout).toHaveBeenCalledWith("business");
  cleanup();
  h.lock = { locked: true, isOwner: false };
  render(<BusinessLockLine teamId="t1" label="line" />);
  expect(screen.queryByText("shared.businessLock.upgrade")).toBeNull();
  expect(screen.queryByText("shared.businessLock.ownerOnly")).toBeNull();
});
