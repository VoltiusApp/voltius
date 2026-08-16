import { test, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { createRef } from "react";

vi.mock("@iconify/react", () => ({ Icon: ({ icon }: { icon: string }) => <i data-icon={icon} /> }));
vi.mock("@/components/shared/AvatarStack", () => ({ MiniAvatar: () => null }));

import { UserSearchField } from "./UserSearchField";

const zoe = { user_id: "u1", handle: "zesty-otter-1180", is_teammate: false };
const ada = { user_id: "u2", handle: "amber-lynx-4410", is_teammate: false };

function renderField(overrides: Partial<React.ComponentProps<typeof UserSearchField>> = {}) {
  const props: React.ComponentProps<typeof UserSearchField> = {
    placeholder: "search…",
    query: "zo",
    onQueryChange: vi.fn(),
    onClear: vi.fn(),
    results: [zoe],
    searching: false,
    open: true,
    setOpen: vi.fn(),
    inputRef: createRef<HTMLInputElement>(),
    dropdownRef: createRef<HTMLDivElement>(),
    adding: null,
    addLabel: "Add",
    onAdd: vi.fn(),
    ...overrides,
  };
  render(<UserSearchField {...props} />);
  return props;
}

afterEach(cleanup);

test("renders one row per result and reports the clicked user", () => {
  const props = renderField({ results: [zoe, ada] });
  expect(screen.getAllByText("Add")).toHaveLength(2);
  fireEvent.click(screen.getByText("amber-lynx-4410"));
  expect(props.onAdd).toHaveBeenCalledExactlyOnceWith(ada);
});

test("a closed dropdown renders no rows", () => {
  renderField({ open: false });
  expect(screen.queryByText("zesty-otter-1180")).toBeNull();
});

test("an empty result set renders nothing without emptyLabel, and the label with it", () => {
  renderField({ results: [] });
  expect(screen.queryByText("no one")).toBeNull();
  cleanup();

  renderField({ results: [], emptyLabel: "no one" });
  expect(screen.getByText("no one")).toBeTruthy();
});

test("the row being added shows a spinner instead of its add badge", () => {
  renderField({ results: [zoe, ada], adding: "u1" });
  expect(screen.getAllByText("Add")).toHaveLength(1);
  expect(document.querySelectorAll('[data-icon="lucide:loader-circle"]')).toHaveLength(1);
});

test("every result row is disabled while an add is in flight", () => {
  renderField({ results: [zoe, ada], adding: "u1" });
  expect(screen.getByText("zesty-otter-1180").closest("button")).toHaveProperty("disabled", true);
  expect(screen.getByText("amber-lynx-4410").closest("button")).toHaveProperty("disabled", true);
});

test("searching swaps the search icon for a spinner", () => {
  renderField({ searching: true, open: false });
  expect(document.querySelector('[data-icon="lucide:search"]')).toBeNull();
  expect(document.querySelector('[data-icon="lucide:loader-circle"]')).toBeTruthy();
});

test("typing reports the new query; the clear button fires onClear", () => {
  const props = renderField();
  fireEvent.change(screen.getByPlaceholderText("search…"), { target: { value: "zoe" } });
  expect(props.onQueryChange).toHaveBeenCalledExactlyOnceWith("zoe");

  fireEvent.click(screen.getAllByRole("button").find((b) => b.querySelector('[data-icon="lucide:x"]'))!);
  expect(props.onClear).toHaveBeenCalledOnce();
});

test("the clear button is absent on an empty query", () => {
  renderField({ query: "", open: false });
  expect(document.querySelector('[data-icon="lucide:x"]')).toBeNull();
});

test("Enter calls onSubmitQuery only when one is supplied", () => {
  const onSubmitQuery = vi.fn();
  renderField({ onSubmitQuery });
  fireEvent.keyDown(screen.getByPlaceholderText("search…"), { key: "Enter" });
  fireEvent.keyDown(screen.getByPlaceholderText("search…"), { key: "a" });
  expect(onSubmitQuery).toHaveBeenCalledOnce();
});

test("focus reopens the dropdown only when there is something to show", () => {
  const props = renderField({ results: [], open: false });
  fireEvent.focus(screen.getByPlaceholderText("search…"));
  expect(props.setOpen).not.toHaveBeenCalled();
  cleanup();

  const withResults = renderField({ open: false });
  fireEvent.focus(screen.getByPlaceholderText("search…"));
  expect(withResults.setOpen).toHaveBeenCalledExactlyOnceWith(true);
});

test("the email option opens the dropdown on an empty result set and invites", () => {
  const onInvite = vi.fn();
  renderField({
    results: [],
    emailOption: { visible: true, label: "Invite zo@x.com", actionLabel: "Invite", sending: false, onInvite },
  });
  fireEvent.click(screen.getByText("Invite zo@x.com"));
  expect(onInvite).toHaveBeenCalledOnce();
});

test("a hidden email option renders no invite row", () => {
  renderField({
    emailOption: { visible: false, label: "Invite zo@x.com", actionLabel: "Invite", sending: false, onInvite: vi.fn() },
  });
  expect(screen.queryByText("Invite zo@x.com")).toBeNull();
});

test("a sending email option disables its row and spins", () => {
  renderField({
    results: [],
    emailOption: { visible: true, label: "Invite zo@x.com", actionLabel: "Invite", sending: true, onInvite: vi.fn() },
  });
  expect(screen.queryByText("Invite")).toBeNull();
  expect(screen.getByText("Invite zo@x.com").closest("button")).toHaveProperty("disabled", true);
});
