import { test, expect, beforeAll } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import i18n from "@/i18n";
import { AuditEventRow } from "./AuditEventRow";
import type { AuditLog } from "@/services/auditService";

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

afterEach(cleanup);

const baseLog: AuditLog = {
  id: 1,
  team_id: "t1",
  vault_id: null,
  actor_id: "u1",
  actor_name: "Alice",
  action: "agent.mode_changed",
  source: "server",
  target_type: null,
  target_id: null,
  target_name: null,
  metadata: { to: "unattended" },
  ip_address: null,
  created_at: "2026-07-25T12:00:00Z",
};

test("metadata.target === 'default' renders the default-mode label", () => {
  render(<AuditEventRow log={{ ...baseLog, metadata: { to: "unattended", target: "default" } }} />);
  expect(screen.getByText("changed the default AI agent mode to unattended")).toBeTruthy();
  expect(screen.queryByText(/for this conversation/)).toBeNull();
});

test("metadata.target === 'conversation' renders the conversation-scoped label", () => {
  render(<AuditEventRow log={{ ...baseLog, metadata: { to: "unattended", target: "conversation" } }} />);
  expect(screen.getByText("changed the AI agent mode to unattended for this conversation")).toBeTruthy();
});

test("missing metadata does not throw and falls back to the conversation-scoped label", () => {
  expect(() => render(<AuditEventRow log={{ ...baseLog, metadata: null }} />)).not.toThrow();
  expect(screen.getByText("changed the AI agent mode to for this conversation")).toBeTruthy();
});
