import { formatTransferProgress } from "./SFTPTypes.ts";
import type { Transfer } from "./SFTPTypes.ts";

function assertEqual(actual: string, expected: string, msg: string) {
  if (actual !== expected) throw new Error(`${msg}\n  expected: ${expected}\n  actual:   ${actual}`);
}

const base: Transfer = { id: "1", label: "f", direction: "→", transferred: 0, total: 0, status: "running" };

// total known, speed + short eta
assertEqual(
  formatTransferProgress({ ...base, transferred: 1024, total: 4096, speed: 2048, eta: 12 }),
  "1.0 KB / 4.0 KB · 2.0 KB/s · 12s",
  "bytes + speed + short eta",
);

// eta >= 60 → minutes
assertEqual(
  formatTransferProgress({ ...base, transferred: 1048576, total: 10485760, speed: 1048576, eta: 125 }),
  "1.0 MB / 10.0 MB · 1.0 MB/s · 2m",
  "eta in minutes",
);

// no speed / no eta yet → just progress
assertEqual(
  formatTransferProgress({ ...base, transferred: 512, total: 2048 }),
  "512 B / 2.0 KB",
  "no speed/eta",
);

// total unknown (0) → only transferred
assertEqual(
  formatTransferProgress({ ...base, transferred: 512, total: 0, speed: 256 }),
  "512 B · 256 B/s",
  "unknown total omits the slash form, keeps speed",
);

// eta == 0 is omitted (treated as done/unknown)
assertEqual(
  formatTransferProgress({ ...base, transferred: 100, total: 100, speed: 100, eta: 0 }),
  "100 B / 100 B · 100 B/s",
  "zero eta omitted",
);

console.log("formatTransferProgress: OK");
