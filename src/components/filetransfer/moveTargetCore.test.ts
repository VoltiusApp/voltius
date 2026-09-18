import { test } from "vitest";
import { pathSep, parentDir, joinPath, isValidMoveTarget, buildMoveTargets } from "./moveTargetCore.ts";
import type { FileEntry } from "@/components/filetransfer/SFTPTypes";

function assertEqual<T>(actual: T, expected: T, msg: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    console.error(`FAIL ${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    throw new Error(msg);
  }
}

const f = (name: string, dir: string, isDir = false): FileEntry =>
  ({ name, path: `${dir.replace(/\/$/, "")}/${name}`, size: 1, isDir, isSymlink: false });

test("moveTargetCore", () => {
  // pathSep
  assertEqual(pathSep("/a/b"), "/", "posix path");
  assertEqual(pathSep("C:\\Users\\x"), "\\", "windows path");
  assertEqual(pathSep("\\\\wsl$\\Ubuntu"), "\\", "unc path");

  // parentDir
  assertEqual(parentDir("/src/logs"), "/src", "posix parent");
  assertEqual(parentDir("/src"), "/", "posix parent of top dir is root");
  assertEqual(parentDir("C:\\Users\\x"), "C:\\Users", "windows parent");
  assertEqual(parentDir("C:\\Users"), "C:\\", "windows drive root keeps its separator");
  assertEqual(parentDir("C:/Users"), "C:/", "windows drive root with forward slashes");
  assertEqual(parentDir("C:\\"), "", "drive root has no parent");
  assertEqual(parentDir("C:"), "", "bare drive spec has no parent");
  assertEqual(parentDir("/"), "", "posix root has no parent");
  assertEqual(parentDir("\\\\wsl$\\Ubuntu\\home"), "\\\\wsl$\\Ubuntu", "unc parent");
  assertEqual(parentDir("\\\\wsl$"), "", "unc server root has no parent");

  // joinPath
  assertEqual(joinPath("/dest/", "a.txt"), "/dest/a.txt", "posix join strips trailing slash");
  assertEqual(joinPath("/", "x"), "/x", "root join no doubled slash");
  assertEqual(joinPath("C:\\Users", "x"), "C:\\Users\\x", "windows join");
  assertEqual(joinPath("C:\\", "x"), "C:\\x", "windows drive root join");

  // isValidMoveTarget — valid: move /src/a.txt into /src/logs
  assertEqual(isValidMoveTarget([f("a.txt", "/src")], "/src/logs"), true, "valid move into sibling folder");
  // already in target dir (target === source parent)
  assertEqual(isValidMoveTarget([f("a.txt", "/src")], "/src"), false, "no-op when already in dir");
  // onto itself (a dragged folder)
  assertEqual(isValidMoveTarget([f("logs", "/src", true)], "/src/logs"), false, "folder onto itself");
  // into own descendant
  assertEqual(isValidMoveTarget([f("logs", "/src", true)], "/src/logs/sub"), false, "folder into own descendant");
  // empty selection
  assertEqual(isValidMoveTarget([], "/src/logs"), false, "empty selection invalid");
  // windows descendant guard (mixed separators normalized)
  assertEqual(isValidMoveTarget([{ name: "d", path: "C:\\a\\d", size: 0, isDir: true, isSymlink: false }], "C:\\a\\d\\sub"), false, "windows descendant guard");

  // buildMoveTargets
  assertEqual(
    buildMoveTargets([f("a.txt", "/src"), f("logs", "/src", true)], "/dest"),
    [
      { from: "/src/a.txt", to: "/dest/a.txt", name: "a.txt", isDir: false },
      { from: "/src/logs", to: "/dest/logs", name: "logs", isDir: true },
    ],
    "builds move targets",
  );
});
