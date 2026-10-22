// @vitest-environment jsdom
import { test, expect } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useFolderNavigation } from "./useFolderNavigation";

test("a folder whose parent is hidden is listed at the root", () => {
  const { result } = renderHook(() => useFolderNavigation([
    { id: "a", parent_folder_id: null },
    { id: "b", parent_folder_id: "hidden" },
  ]));
  expect(result.current.visibleFolders.map((f) => f.id)).toEqual(["a", "b"]);
});

test("a path into folders that left the list falls back to the root", () => {
  const vaultA = [{ id: "a", parent_folder_id: null }];
  const { result, rerender } = renderHook(({ folders }) => useFolderNavigation(folders), { initialProps: { folders: vaultA } });
  act(() => result.current.navigateInto(vaultA[0]));
  expect(result.current.activeFolderId).toBe("a");

  rerender({ folders: [{ id: "b", parent_folder_id: null }] });
  expect(result.current.activeFolderId).toBeNull();
  expect(result.current.folderPath).toEqual([]);

  rerender({ folders: vaultA });
  expect(result.current.activeFolderId).toBeNull();
});

const nested = [
  { id: "servers", parent_folder_id: null, name: "Servers" },
  { id: "prod", parent_folder_id: "servers", name: "Production" },
];

test("a remembered path is restored when the page mounts again", () => {
  const first = renderHook(() => useFolderNavigation(nested, "remount"));
  act(() => first.result.current.navigateInto(nested[0]));
  act(() => first.result.current.navigateInto(nested[1]));
  first.unmount();

  const second = renderHook(() => useFolderNavigation(nested, "remount"));
  expect(second.result.current.folderPath.map((f) => f.id)).toEqual(["servers", "prod"]);
  expect(second.result.current.activeFolderId).toBe("prod");
});

test("a remembered path into a folder deleted meanwhile falls back to the root", () => {
  const first = renderHook(() => useFolderNavigation(nested, "deleted"));
  act(() => first.result.current.navigateInto(nested[0]));
  act(() => first.result.current.navigateInto(nested[1]));
  first.unmount();

  const second = renderHook(() => useFolderNavigation([nested[0]], "deleted"));
  expect(second.result.current.folderPath).toEqual([]);
  second.unmount();

  const third = renderHook(() => useFolderNavigation(nested, "deleted"));
  expect(third.result.current.activeFolderId).toBeNull();
});

test("paths are remembered per key and not without one", () => {
  const hosts = renderHook(() => useFolderNavigation(nested, "per-key"));
  act(() => hosts.result.current.navigateInto(nested[0]));
  hosts.unmount();

  expect(renderHook(() => useFolderNavigation(nested, "other-key")).result.current.folderPath).toEqual([]);
  expect(renderHook(() => useFolderNavigation(nested)).result.current.folderPath).toEqual([]);
});

test("the breadcrumb shows a folder's current name after a rename", () => {
  const { result, rerender } = renderHook(({ folders }) => useFolderNavigation(folders), { initialProps: { folders: nested } });
  act(() => result.current.navigateInto(nested[0]));
  rerender({ folders: [{ ...nested[0], name: "Boxes" }, nested[1]] });
  expect(result.current.folderPath[0].name).toBe("Boxes");
});

test("navigateUp leaves one level", () => {
  const { result } = renderHook(() => useFolderNavigation(nested));
  act(() => result.current.navigateInto(nested[0]));
  act(() => result.current.navigateInto(nested[1]));
  act(() => result.current.navigateUp());
  expect(result.current.activeFolderId).toBe("servers");
});

test("a remembered folder moved elsewhere meanwhile restores under its new parent", () => {
  const first = renderHook(() => useFolderNavigation(nested, "moved"));
  act(() => first.result.current.navigateInto(nested[0]));
  act(() => first.result.current.navigateInto(nested[1]));
  first.unmount();

  const moved = [{ id: "staging", parent_folder_id: null, name: "Staging" }, nested[0], { ...nested[1], parent_folder_id: "staging" }];
  const second = renderHook(() => useFolderNavigation(moved, "moved"));
  expect(second.result.current.folderPath.map((f) => f.id)).toEqual(["staging", "prod"]);
});

test("a parent cycle does not loop", () => {
  const cyclic = [{ id: "a", parent_folder_id: "b" }, { id: "b", parent_folder_id: "a" }];
  const { result } = renderHook(() => useFolderNavigation(cyclic));
  act(() => result.current.navigateInto(cyclic[0]));
  expect(result.current.folderPath.map((f) => f.id)).toEqual(["b", "a"]);
});

test("levelOf describes any folder, and a missing one as the root", () => {
  const { result } = renderHook(() => useFolderNavigation(nested));
  const prod = result.current.levelOf("prod");
  expect(prod.folderPath.map((f) => f.id)).toEqual(["servers", "prod"]);
  expect(prod.ejectTargetFolderId).toBe("servers");
  expect(result.current.levelOf("gone")).toMatchObject({ activeFolderId: null, folderPath: [] });
});
