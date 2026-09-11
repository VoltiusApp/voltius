import { test, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

vi.mock("@iconify/react", () => ({ Icon: ({ icon }: { icon: string }) => <i data-icon={icon} /> }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

import { PERM_BITS } from "@/services/permissions";
import type { TeamMember, TeamRole } from "@/services/teamService";
import { RoleBadges } from "./roleBadges";

afterEach(cleanup);

const member = (allow: number, deny: number, role_ids: string[] = []): TeamMember => ({
  team_id: "t1", user_id: "u1", handle: "alice", public_key: "k",
  invited_by_display_name: null, joined_at: "", role_ids,
  permission_allow: allow, permission_deny: deny,
});

const role: TeamRole = {
  id: "r1", team_id: "t1", name: "editor", permissions: 0,
  is_builtin: true, position: 0, created_at: "",
};

test("no-role member with an allow override shows the marker", () => {
  render(<RoleBadges member={member(PERM_BITS.CONNECT, 0)} roles={[]} />);
  expect(screen.getByTestId("override-marker")).toBeTruthy();
});

test("no-role member with a deny override shows the marker", () => {
  render(<RoleBadges member={member(0, PERM_BITS.CONNECT)} roles={[]} />);
  expect(screen.getByTestId("override-marker")).toBeTruthy();
});

test("no-role member with both masks empty shows no marker", () => {
  render(<RoleBadges member={member(0, 0)} roles={[]} />);
  expect(screen.queryByTestId("override-marker")).toBeNull();
});

test("no-role member with canManage and onAddRole still shows the marker", () => {
  render(
    <RoleBadges member={member(PERM_BITS.CONNECT, 0)} roles={[]} canManage onAddRole={() => {}} />,
  );
  expect(screen.getByTestId("override-marker")).toBeTruthy();
});

test("no-role member with canManage and onAddRole and no overrides shows no marker", () => {
  render(<RoleBadges member={member(0, 0)} roles={[]} canManage onAddRole={() => {}} />);
  expect(screen.queryByTestId("override-marker")).toBeNull();
});

test("member with a resolvable role and an override shows the marker", () => {
  render(<RoleBadges member={member(PERM_BITS.CONNECT, 0, ["r1"])} roles={[role]} />);
  expect(screen.getByTestId("override-marker")).toBeTruthy();
});

test("member with a resolvable role and no overrides shows no marker", () => {
  render(<RoleBadges member={member(0, 0, ["r1"])} roles={[role]} />);
  expect(screen.queryByTestId("override-marker")).toBeNull();
});
