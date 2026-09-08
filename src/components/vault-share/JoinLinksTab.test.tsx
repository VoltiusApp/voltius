import { test, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  grants: [] as unknown[],
  create: vi.fn(),
  revoke: vi.fn().mockResolvedValue(undefined),
  writeClipboard: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/services/teamJoinGrants", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/teamJoinGrants")>()),
  listJoinGrants: () => Promise.resolve(h.grants),
  createJoinGrant: h.create,
  revokeJoinGrant: h.revoke,
}));
// Passes the action straight through: the toast wrapper is not what these
// tests are about, and mocking it keeps the notification store out of them.
vi.mock("@/services/teamActionFeedback", () => ({
  runTeamAction: ({ run }: { run: () => Promise<unknown> }) => run(),
}));
vi.mock("@/utils/clipboard", () => ({ writeClipboard: h.writeClipboard }));

import { JoinLinksTab } from "./JoinLinksTab";

const ROLES = [
  { id: "r1", team_id: "t1", name: "member", permissions: 0, is_builtin: true, position: 2, created_at: "" },
  { id: "r2", team_id: "t1", name: "connect-only", permissions: 0, is_builtin: true, position: 3, created_at: "" },
  // Never offered by a link: the server answers 400 for it.
  { id: "r0", team_id: "t1", name: "owner", permissions: 0, is_builtin: true, position: 0, created_at: "" },
];

const inADay = () => new Date(Date.now() + 24 * 3600_000).toISOString();

afterEach(() => { cleanup(); h.grants = []; vi.clearAllMocks(); });

/** The mint form is folded away behind "New link"; open it. */
const openForm = async () => {
  await waitFor(() => expect(screen.getByText("members.joinLinks.newLink")).toBeTruthy());
  fireEvent.click(screen.getByText("members.joinLinks.newLink"));
};

test("owner is never offered as a link role", async () => {
  render(<JoinLinksTab teamId="t1" roles={ROLES} canMint />);
  await openForm();
  expect(screen.queryByText("owner")).toBeNull();
  expect(screen.getByText("member")).toBeTruthy();
  expect(screen.getByText("connect-only")).toBeTruthy();
});

test("the default role is the least privileged one, never 'member'", async () => {
  h.create.mockResolvedValue({ id: "g1", secret: "s".repeat(43), role: "connect-only", max_uses: 1, uses: 0, expires_at: inADay(), created_by: "u1" });
  render(<JoinLinksTab teamId="t1" roles={ROLES} canMint />);
  await openForm();

  fireEvent.click(screen.getByText("members.joinLinks.create"));
  await waitFor(() => expect(h.create).toHaveBeenCalled());
  expect(h.create.mock.calls[0][1].role).toBe("connect-only");
});

test("a grant listed from the server offers no Copy — its secret is unrecoverable", async () => {
  h.grants = [{ id: "g1", role: "member", max_uses: 5, uses: 2, expires_at: inADay(), created_by: "u1" }];
  render(<JoinLinksTab teamId="t1" roles={ROLES} canMint />);
  await waitFor(() => expect(screen.getByText("members.joinLinks.secretNotRecoverable")).toBeTruthy());
  expect(screen.queryByText("members.joinLinks.copy")).toBeNull();
});

test("the freshly minted grant is the only one that offers its link", async () => {
  const secret = "s".repeat(43);
  h.create.mockResolvedValue({ id: "g1", secret, role: "member", max_uses: 1, uses: 0, expires_at: inADay(), created_by: "u1" });
  const { rerender } = render(<JoinLinksTab teamId="t1" roles={ROLES} canMint />);
  await openForm();

  // The reload after minting is what surfaces the row the link belongs to.
  h.grants = [{ id: "g1", role: "member", max_uses: 1, uses: 0, expires_at: inADay(), created_by: "u1" }];
  fireEvent.click(screen.getByText("members.joinLinks.create"));
  rerender(<JoinLinksTab teamId="t1" roles={ROLES} canMint />);

  const field = await waitFor(() => screen.getByDisplayValue(new RegExp(secret)));
  expect((field as HTMLInputElement).value).toContain("#vault-join?g=g1&k=");
  // The secret rides in the fragment, so it never reaches a web server log.
  expect((field as HTMLInputElement).value.split("#")[0]).not.toContain(secret);
});

test("a viewer who cannot mint sees the list but no create form", async () => {
  h.grants = [{ id: "g1", role: "member", max_uses: 5, uses: 0, expires_at: inADay(), created_by: "u1" }];
  render(<JoinLinksTab teamId="t1" roles={ROLES} canMint={false} />);
  await waitFor(() => expect(screen.getByText("members.joinLinks.secretNotRecoverable")).toBeTruthy());
  expect(screen.queryByText("members.joinLinks.newLink")).toBeNull();
  expect(screen.queryByText("members.joinLinks.create")).toBeNull();
  expect(screen.queryByTitle("members.joinLinks.revoke")).toBeNull();
});
