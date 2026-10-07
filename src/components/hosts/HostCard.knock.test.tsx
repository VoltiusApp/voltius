import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { Connection } from "@/types";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));
vi.mock("@/services/vault", () => ({ getSecret: vi.fn() }));
vi.mock("@/services/credentials", () => ({ findConnection: () => undefined }));
vi.mock("@/components/shared/BaseCard", () => ({
  BaseCard: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ConnectionAvatar", () => ({ ConnectionAvatar: () => null }));
vi.mock("@/components/shared/CardActionButton", () => ({
  CardActionButton: () => null,
  CardMenuButton: () => null,
  CardPinButton: () => null,
}));
vi.mock("@/components/shared/OverflowTagList", () => ({ OverflowTagList: () => null }));
vi.mock("@/components/shared/AvatarStack", () => ({ MiniAvatar: () => null }));
vi.mock("@/hooks/useConnectionPresence", () => ({ useConnectionPresence: () => null }));
vi.mock("@/hooks/useUIContributions", () => ({ useUIContributions: () => [] }));
vi.mock("@/hooks/useCanConnect", () => ({ useCanConnect: () => true }));
vi.mock("@/hooks/useConnectAsMenuItem", () => ({ useConnectAsMenuItem: () => undefined }));
vi.mock("@/hooks/useCredentialPlan", () => ({ useCredentialPlan: () => ({ plan: null }) }));
vi.mock("@/services/credentialScope", () => ({ effectiveUsername: () => "root" }));
vi.mock("@/hooks/useEffectivePinned", () => ({
  useEffectivePinned: () => false,
  useEffectivePinSource: () => "none",
  nextPersonalPinValue: () => true,
}));
vi.mock("@/stores/toggleSettingsStore", () => ({ useToggle: () => [true] }));
vi.mock("@/utils/connectionMenuItems", () => ({ buildConnectionMenuItems: () => [] }));

const { default: HostCard } = await import("./HostCard");
const { useHostPingStore } = await import("@/stores/hostPingStore");

const conn = {
  id: "c1", host: "h1", port: 22, username: "root", tags: [], vault_id: "personal",
  port_knock: { enabled: true },
} as unknown as Connection;

function renderCard(layout: "grid" | "list" = "grid") {
  const noop = vi.fn();
  return render(
    <HostCard connection={conn} layout={layout} onConnect={noop} onEdit={noop} onDuplicate={noop} onDelete={noop} />,
  );
}

vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });

beforeEach(() => useHostPingStore.setState({ statuses: {}, latencies: {} }));
afterEach(cleanup);

describe("HostCard knock-protected", () => {
  test("shows the closed lock and no latency while the status is knock", () => {
    useHostPingStore.setState({ statuses: { c1: "knock" }, latencies: {} });
    const { container } = renderCard();
    expect(container.querySelector('[title="hosts.card.knockProtected"]')).not.toBeNull();
    expect(container.textContent).not.toContain("ms");
  });

  test("shows the open lock and latency once the knock window is open", () => {
    useHostPingStore.setState({ statuses: { c1: "up" }, latencies: { c1: 41 } });
    const { container } = renderCard();
    expect(container.querySelector('[title="hosts.card.knockWindowOpen"]')).not.toBeNull();
    expect(container.textContent).toContain("41 ms");
  });

  test.each([["down"], [undefined]])("shows no lock for a gated host with status %s", (status) => {
    useHostPingStore.setState({ statuses: status ? { c1: status as "down" } : {}, latencies: {} });
    const { container } = renderCard();
    expect(container.querySelector('[title="hosts.card.knockProtected"]')).toBeNull();
    expect(container.querySelector('[title="hosts.card.knockWindowOpen"]')).toBeNull();
  });

  test("list view labels the address line instead of showing latency", () => {
    useHostPingStore.setState({ statuses: { c1: "knock" }, latencies: {} });
    const { container } = renderCard("list");
    expect(container.textContent).toContain("hosts.card.knockProtectedShort");
  });
});
