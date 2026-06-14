import { buildTransferTargets } from "./sftpTransferCore.ts";
import type { FileEntry } from "@/components/filetransfer/SFTPTypes";

function assertEqual<T>(actual: T, expected: T, msg: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    console.error(`FAIL ${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    throw new Error(msg);
  }
  console.log(`PASS ${msg}`);
}

const file = (name: string, isDir = false): FileEntry => ({ name, path: `/src/${name}`, size: 1, isDir, isSymlink: false });

{
  const out = buildTransferTargets([file("a.txt"), file("logs", true)], "/dest/");
  assertEqual(out, [
    { srcPath: "/src/a.txt", dstPath: "/dest/a.txt", isDir: false, name: "a.txt" },
    { srcPath: "/src/logs", dstPath: "/dest/logs", isDir: true, name: "logs" },
  ], "builds targets, joins paths, strips trailing slash");
}

{
  const out = buildTransferTargets([file("x")], "/");
  assertEqual(out[0].dstPath, "/x", "root dest joins without doubling slash");
}

console.log("ALL PASS");
