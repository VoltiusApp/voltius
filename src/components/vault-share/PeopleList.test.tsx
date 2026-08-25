import { test, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/components/shared/PresenceAvatar", () => ({
  PresenceAvatar: ({ handle }: { handle: string }) => <div>{`avatar:${handle}`}</div>,
}));

import { PeopleList, type Person } from "./PeopleList";

const person = (over: Partial<Person>): Person => ({
  userId: "u1", handle: "bob-builder", roleNames: ["member"], online: false, state: "member", ...over,
});

afterEach(cleanup);

test("the handle is rendered in full, never truncated in markup", () => {
  render(<PeopleList people={[person({})]} canManage onRemove={vi.fn()} onRevoke={vi.fn()} onGrantKey={vi.fn()} onCopyInviteLink={vi.fn()} />);
  expect(screen.getByText("bob-builder")).toBeTruthy();
});

test("pending people appear in the same list with a pending marker", () => {
  render(<PeopleList people={[person({ state: "pending", invitationId: "inv-1" })]} canManage onRemove={vi.fn()} onRevoke={vi.fn()} onGrantKey={vi.fn()} onCopyInviteLink={vi.fn()} />);
  expect(screen.getByText("members.people.pending")).toBeTruthy();
});

test("a pending person offers a copy-link action", () => {
  const onCopy = vi.fn();
  render(<PeopleList people={[person({ state: "pending", invitationId: "inv-1" })]} canManage onRemove={vi.fn()} onRevoke={vi.fn()} onGrantKey={vi.fn()} onCopyInviteLink={onCopy} />);
  fireEvent.click(screen.getByTitle("members.people.copyInviteLink"));
  expect(onCopy).toHaveBeenCalledWith(expect.objectContaining({ invitationId: "inv-1" }));
});

test("an awaiting-key person offers Grant now to a manager", () => {
  const onGrant = vi.fn();
  render(<PeopleList people={[person({ state: "awaiting_key" })]} canManage onRemove={vi.fn()} onRevoke={vi.fn()} onGrantKey={onGrant} onCopyInviteLink={vi.fn()} />);
  fireEvent.click(screen.getByText("members.people.grantKey"));
  expect(onGrant).toHaveBeenCalled();
});

test("a non-manager sees no destructive actions", () => {
  render(<PeopleList people={[person({})]} canManage={false} onRemove={vi.fn()} onRevoke={vi.fn()} onGrantKey={vi.fn()} onCopyInviteLink={vi.fn()} />);
  expect(screen.queryByTitle("members.people.remove")).toBeNull();
});
