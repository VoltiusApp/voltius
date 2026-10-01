import { test, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { AuditLog } from "@/services/auditService";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string, o?: Record<string, string>) => (o?.name ? `${k}:${o.name}` : k) }) }));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));
vi.mock("@/stores/identityStore", () => ({
  useIdentityStore: (sel: (s: unknown) => unknown) => sel({ identities: [], teamIdentities: { t1: [{ id: "shared", name: "ops-deploy", username: "deploy" }] } }),
}));

import { AuditEventRow } from "./AuditEventRow";

afterEach(cleanup);

const log = (metadata: Record<string, unknown> | null) =>
  ({ id: "1", action: "connection.started", actor_id: "u", actor_name: "bob", target_name: "web-01", source: "client", ip_address: "10.0.0.1", created_at: new Date().toISOString(), metadata }) as unknown as AuditLog;

test("own key shows a badge and the fingerprint", () => {
  render(<AuditEventRow log={log({ identity_source: "own", key_fingerprint: "SHA256:abc" })} />);
  expect(screen.getByText("logs.badges.ownKey")).toBeTruthy();
  expect(screen.getByText("SHA256:abc")).toBeTruthy();
});

test("team identity is named from the reader's stores", () => {
  render(<AuditEventRow log={log({ identity_source: "team", identity_id: "shared" })} />);
  expect(screen.getByText("logs.badges.shared:ops-deploy")).toBeTruthy();
});

test("unknown team identity and host source", () => {
  const { unmount } = render(<AuditEventRow log={log({ identity_source: "team", identity_id: "hidden" })} />);
  expect(screen.getByText("logs.badges.sharedUnknown")).toBeTruthy();
  unmount();
  render(<AuditEventRow log={log({ identity_source: "host" })} />);
  expect(screen.queryByText(/logs\.badges\.(ownKey|shared)/)).toBeNull();
});
