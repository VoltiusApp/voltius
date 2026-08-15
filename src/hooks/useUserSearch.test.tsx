import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";

const h = vi.hoisted(() => ({ searchUsers: vi.fn() }));
vi.mock("@/services/teamService", () => ({ searchUsers: h.searchUsers }));

import { useUserSearch } from "./useUserSearch";

const zoe = { user_id: "u1", display_name: "Zoe", handle: "zoe", is_teammate: false };
const ada = { user_id: "u2", display_name: "Ada", handle: "ada", is_teammate: false };

beforeEach(() => {
  h.searchUsers.mockReset();
  h.searchUsers.mockResolvedValue([zoe, ada]);
  vi.useFakeTimers();
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

test("queries below 2 chars never hit the service", async () => {
  const { result } = renderHook(() => useUserSearch());
  act(() => result.current.setQuery("z"));
  await act(async () => { await vi.advanceTimersByTimeAsync(500); });
  expect(h.searchUsers).not.toHaveBeenCalled();
  expect(result.current.open).toBe(false);
});

test("debounces 250ms and opens the dropdown with the results", async () => {
  const { result } = renderHook(() => useUserSearch());
  act(() => result.current.setQuery("zo"));
  await act(async () => { await vi.advanceTimersByTimeAsync(200); });
  expect(h.searchUsers).not.toHaveBeenCalled();

  await act(async () => { await vi.advanceTimersByTimeAsync(50); });
  expect(h.searchUsers).toHaveBeenCalledExactlyOnceWith("zo");
  expect(result.current.results).toEqual([zoe, ada]);
  expect(result.current.open).toBe(true);
  expect(result.current.searching).toBe(false);
});

test("keystrokes inside the debounce window collapse into one call", async () => {
  const { result } = renderHook(() => useUserSearch());
  act(() => result.current.setQuery("zo"));
  await act(async () => { await vi.advanceTimersByTimeAsync(100); });
  act(() => result.current.setQuery("zoe"));
  await act(async () => { await vi.advanceTimersByTimeAsync(250); });
  expect(h.searchUsers).toHaveBeenCalledExactlyOnceWith("zoe");
});

test("excludeIds filters out ids already present", async () => {
  const excluded = new Set(["u2"]);
  const { result } = renderHook(() => useUserSearch(excluded));
  act(() => result.current.setQuery("zo"));
  await act(async () => { await vi.advanceTimersByTimeAsync(250); });
  expect(result.current.results).toEqual([zoe]);
});

test("an unmemoized excludeIds does not re-run the search on every render", async () => {
  const { result } = renderHook(() => useUserSearch(new Set(["u2"])));
  act(() => result.current.setQuery("zo"));
  await act(async () => { await vi.advanceTimersByTimeAsync(250); });
  expect(result.current.results).toEqual([zoe]);
  expect(h.searchUsers).toHaveBeenCalledTimes(1);

  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(h.searchUsers).toHaveBeenCalledTimes(1);
});

test("a changed exclusion set re-runs the search", async () => {
  let excluded = new Set(["u2"]);
  const { result, rerender } = renderHook(() => useUserSearch(excluded));
  act(() => result.current.setQuery("zo"));
  await act(async () => { await vi.advanceTimersByTimeAsync(250); });
  expect(result.current.results).toEqual([zoe]);

  excluded = new Set(["u1"]);
  rerender();
  await act(async () => { await vi.advanceTimersByTimeAsync(250); });
  expect(h.searchUsers).toHaveBeenCalledTimes(2);
  expect(result.current.results).toEqual([ada]);
});

test("shrinking the query back below the minimum clears results and closes", async () => {
  const { result } = renderHook(() => useUserSearch());
  act(() => result.current.setQuery("zo"));
  await act(async () => { await vi.advanceTimersByTimeAsync(250); });
  expect(result.current.open).toBe(true);

  act(() => result.current.setQuery("z"));
  expect(result.current.results).toEqual([]);
  expect(result.current.open).toBe(false);
});

test("a rejected search leaves the dropdown closed and clears the spinner", async () => {
  h.searchUsers.mockRejectedValue(new Error("offline"));
  const { result } = renderHook(() => useUserSearch());
  act(() => result.current.setQuery("zo"));
  await act(async () => { await vi.advanceTimersByTimeAsync(250); });
  expect(result.current.open).toBe(false);
  expect(result.current.searching).toBe(false);
});

test("mousedown outside both refs closes the dropdown, inside does not", async () => {
  const { result } = renderHook(() => useUserSearch());
  const input = document.createElement("input");
  const dropdown = document.createElement("div");
  document.body.append(input, dropdown);
  act(() => {
    result.current.inputRef.current = input;
    result.current.dropdownRef.current = dropdown;
    result.current.setQuery("zo");
  });
  await act(async () => { await vi.advanceTimersByTimeAsync(250); });
  expect(result.current.open).toBe(true);

  act(() => { dropdown.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); });
  expect(result.current.open).toBe(true);

  act(() => { document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); });
  expect(result.current.open).toBe(false);

  input.remove(); dropdown.remove();
});

test("reset clears query, results and open state", async () => {
  const { result } = renderHook(() => useUserSearch());
  act(() => result.current.setQuery("zo"));
  await act(async () => { await vi.advanceTimersByTimeAsync(250); });

  act(() => result.current.reset());
  expect(result.current.query).toBe("");
  expect(result.current.results).toEqual([]);
  expect(result.current.open).toBe(false);
});
