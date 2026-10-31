// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { useUIStore } from "@/stores/uiStore";
import MobileMoreScreen from "./MobileMoreScreen";
import { useMobileNavStore } from "@/stores/mobileNavStore";
import { useSubscriptionStore } from "@/stores/subscriptionStore";
import { deriveTierFlags } from "@/stores/subscriptionTier";
import { acme, forgetTeams, nameSeatTeam } from "@/services/planDisplay.testHarness";
import "@/i18n";

vi.mock("../MobileHeader", () => ({ default: () => null }));
vi.mock("@/services/account", () => ({ getCurrentUserEmail: async () => null }));
afterEach(cleanup);

test("opens Import/Export from More", () => {
  const open = vi.spyOn(useUIStore.getState(), "openImportExport");
  const { container } = render(<MobileMoreScreen />);
  fireEvent.click(container.querySelector('[data-more-page="import-export"]')!);
  expect(open).toHaveBeenCalledWith("import");
});

test("Vault settings for the active vault leads More", () => {
  const { container } = render(<MobileMoreScreen />);
  const row = container.querySelector('[data-more-page="vault-settings"]')!;
  expect(container.querySelector("[data-more-page]")).toBe(row);
  fireEvent.click(row);
  expect(useMobileNavStore.getState().stack.slice(-1)[0]).toEqual({ kind: "vault-settings", vaultId: "personal" });
});

test("the account row names a seat plan and the team it comes through", () => {
  const initial = useSubscriptionStore.getState();
  nameSeatTeam();
  useSubscriptionStore.setState({
    ...deriveTierFlags({ tier: "teams", billing_tier: "free", seat_team: acme }, new Date()),
    accountMode: "server",
  });
  try {
    const { container } = render(<MobileMoreScreen />);
    expect(container.querySelector("[data-more-plan]")!.textContent).toBe("Teams · through your seat in Acme");
  } finally {
    useSubscriptionStore.setState(initial, true);
    forgetTeams();
  }
});
