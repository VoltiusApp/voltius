import { test, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { AuditLog } from "@/services/auditService";

const known = new Set(["logs.filters.actionOptions.portForwardCreated", "logs.filters.actionOptions.memberRoleChanged"]);
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/i18n", () => ({ default: { t: (k: string) => k, exists: (k: string) => known.has(k) } }));
vi.mock("@/stores/identityStore", () => ({ useIdentityStore: (sel: (s: unknown) => unknown) => sel({ identities: [], teamIdentities: {} }) }));

import { AuditList } from "./AuditList";
import { actionName } from "./AuditEventRow";

afterEach(cleanup);

const log = (id: number, action: string, target_name: string | null) =>
  ({ id, action, actor_id: "u", actor_name: "bob", target_name, target_id: null, source: "server", ip_address: null, created_at: "2026-10-04T12:00:00Z", metadata: null }) as unknown as AuditLog;

test("an action maps to its target-free filter label, an unknown one stays raw", () => {
  expect(actionName("port_forward.created")).toBe("logs.filters.actionOptions.portForwardCreated");
  expect(actionName("member.role_changed")).toBe("logs.filters.actionOptions.memberRoleChanged");
  expect(actionName("plugin.custom")).toBe("plugin.custom");
});

test("each row fills the actor, action and target columns", () => {
  render(<AuditList logs={[log(1, "port_forward.created", "Postgres prod"), log(2, "plugin.custom", null)]} />);
  expect(screen.getByText("Postgres prod")).toBeTruthy();
  expect(screen.getByText("logs.filters.actionOptions.portForwardCreated")).toBeTruthy();
  expect(screen.getByText("—")).toBeTruthy();
  expect(screen.getAllByText("bob")).toHaveLength(2);
});
