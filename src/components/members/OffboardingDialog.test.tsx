import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { TeamMember } from "@/services/teamService";

const h = vi.hoisted(() => ({ depart: vi.fn(async () => {}) }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/services/teamOffboarding", () => ({
  departMembers: h.depart,
  departConsequences: (mode: string) => ({
    title: mode === "leave" ? "Leave this team?" : "Remove ana from this team?",
    points: ["Access ends immediately.", "They keep what they saw."],
    confirmLabel: mode === "leave" ? "Leave team" : "Remove",
  }),
}));

import { OffboardingDialog } from "./OffboardingDialog";

const members: TeamMember[] = [
  {
    team_id: "t1",
    user_id: "a",
    handle: "ana",
    invited_by_display_name: null,
    joined_at: "2024-01-01",
    public_key: "",
    role_ids: [],
  },
];

beforeEach(() => h.depart.mockClear());
afterEach(cleanup);

test("states every consequence before confirming", () => {
  render(<OffboardingDialog members={members} teamId="t1" mode="remove" onClose={() => {}} />);

  expect(screen.getByText("Remove ana from this team?")).toBeTruthy();
  expect(screen.getByText("Access ends immediately.")).toBeTruthy();
  expect(screen.getByText("They keep what they saw.")).toBeTruthy();
});

test("does nothing until confirmed", () => {
  render(<OffboardingDialog members={members} teamId="t1" mode="remove" onClose={() => {}} />);

  expect(h.depart).not.toHaveBeenCalled();
});

test("confirming departs the members and closes", async () => {
  const onClose = vi.fn();
  render(<OffboardingDialog members={members} teamId="t1" mode="remove" onClose={onClose} />);

  fireEvent.click(screen.getByText("Remove"));

  await waitFor(() =>
    expect(h.depart).toHaveBeenCalledWith("t1", members, expect.objectContaining({ mode: "remove" })),
  );
  await waitFor(() => expect(onClose).toHaveBeenCalled());
});

test("cancelling departs nobody", () => {
  const onClose = vi.fn();
  render(<OffboardingDialog members={members} teamId="t1" mode="remove" onClose={onClose} />);

  fireEvent.click(screen.getByText("settings.shared.cancel"));

  expect(h.depart).not.toHaveBeenCalled();
  expect(onClose).toHaveBeenCalled();
});

test("leaving uses the leave copy and mode", async () => {
  render(<OffboardingDialog members={members} teamId="t1" mode="leave" onClose={() => {}} />);

  expect(screen.getByText("Leave this team?")).toBeTruthy();
  fireEvent.click(screen.getByText("Leave team"));

  await waitFor(() =>
    expect(h.depart).toHaveBeenCalledWith("t1", members, expect.objectContaining({ mode: "leave" })),
  );
});

test("onDone is handed through to the service", async () => {
  const onDone = vi.fn();
  render(
    <OffboardingDialog members={members} teamId="t1" mode="remove" onClose={() => {}} onDone={onDone} />,
  );

  fireEvent.click(screen.getByText("Remove"));

  await waitFor(() =>
    expect(h.depart).toHaveBeenCalledWith("t1", members, expect.objectContaining({ onDone })),
  );
});
