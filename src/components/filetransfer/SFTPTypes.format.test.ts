// @vitest-environment jsdom
import { formatPermissions, formatSize, formatModified } from "./SFTPTypes.ts";
import { test } from "vitest";

test("SFTPTypes.format", async () => {
let fails = 0;
function assertEqual(actual: unknown, expected: unknown, msg: string) {
  if (actual !== expected) { console.error(`FAIL ${msg}: got ${actual}, want ${expected}`); fails++; }
  else { console.log(`ok ${msg}`); }
}

{
  assertEqual(formatPermissions(0o755), "rwxr-xr-x", "perms 755");
  assertEqual(formatPermissions(0o640), "rw-r-----", "perms 640");
  assertEqual(formatPermissions(0o000), "---------", "perms 000");
  assertEqual(formatPermissions(0o777), "rwxrwxrwx", "perms 777");
}
{
  assertEqual(formatSize(512), "512 B", "size B");
  assertEqual(formatSize(2048), "2.0 KB", "size KB");
}
{
  // 14 days after epoch — stays "Jan 15, 1970" in any realistic TZ offset
  assertEqual(formatModified(1209600), "Jan 15, 1970", "date past-year branch");

  const now = new Date(2026, 9, 4, 12, 0);
  const at = (d: Date) => Math.floor(d.getTime() / 1000);
  assertEqual(/^\d{2}:\d{2}( [AP]M)?$/.test(formatModified(at(new Date(2026, 9, 4, 3, 50)), now)), true, "date today shows time only");
  assertEqual(formatModified(at(new Date(2026, 3, 8, 3, 50)), now), "Apr 8", "date this year drops the time");
  assertEqual(formatModified(at(new Date(2024, 3, 8)), now), "Apr 8, 2024", "date past year");
}

if (fails > 0) { console.error(`${fails} failures`); throw new Error("test failures"); }
});
