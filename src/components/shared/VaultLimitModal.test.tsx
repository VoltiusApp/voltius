// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({ startTrialOrCheckout: vi.fn(async () => true) }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/services/promos", () => ({ startTrialOrCheckout: h.startTrialOrCheckout }));
vi.mock("@/services/distribution", () => ({ CAN_OPEN_CHECKOUT: true }));
vi.mock("@/services/serverCapabilities", () => ({ useServerBillingEnabled: () => true }));

import { VaultLimitModal } from "./VaultLimitModal";
import { useSubscriptionStore } from "@/stores/subscriptionStore";

const initial = useSubscriptionStore.getState();
afterEach(() => {
  cleanup();
  useSubscriptionStore.setState(initial, true);
  h.startTrialOrCheckout.mockClear();
});

test("vault_limit_opens_pro_modal_when_available", async () => {
  useSubscriptionStore.setState({ accountMode: "server", tier: "free", billingTier: "free", seatTeam: null });
  const onClose = vi.fn();
  render(<VaultLimitModal onClose={onClose} />);
  fireEvent.click(screen.getByText("layout.vaultSidebar.upgradeToPro"));
  expect(h.startTrialOrCheckout).toHaveBeenCalledWith("pro", "vault_limit", "vaults");
  await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
});
