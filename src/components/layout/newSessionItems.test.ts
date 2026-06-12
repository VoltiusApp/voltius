import {
  shellLabel,
  shellIcon,
  localShellMatches,
  selectLocalShellItems,
  localShellNeedsPath,
  type ShellOption,
} from "./newSessionItems.ts";

function assertEqual<T>(actual: T, expected: T, msg: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    console.error(`FAIL ${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    throw new Error(msg);
  }
  console.log(`PASS ${msg}`);
}

const zsh: ShellOption = { name: "zsh", path: "/bin/zsh" };
const bash: ShellOption = { name: "bash", path: "/bin/bash" };
const fish1: ShellOption = { name: "fish", path: "/usr/bin/fish" };
const fish2: ShellOption = { name: "fish", path: "/usr/local/bin/fish" };
const all = [zsh, bash, fish1];

// shellLabel
assertEqual(shellLabel("zsh"), "Zsh", "shellLabel capitalizes single word");
assertEqual(shellLabel("PowerShell 7+"), "PowerShell 7+", "shellLabel leaves multi-word untouched");

// shellIcon
assertEqual(shellIcon("PowerShell 7+"), "lucide:terminal", "shellIcon powershell");
assertEqual(shellIcon("Command Prompt"), "lucide:square-chevron-right", "shellIcon cmd");
assertEqual(shellIcon("zsh"), "lucide:square-terminal", "shellIcon default");

// localShellMatches
assertEqual(localShellMatches(zsh, ""), true, "empty query matches");
assertEqual(localShellMatches(zsh, "zs"), true, "name substring matches");
assertEqual(localShellMatches(bash, "/bin/ba"), true, "path substring matches");
assertEqual(localShellMatches(zsh, "loc"), true, "keyword prefix 'loc' matches");
assertEqual(localShellMatches(zsh, "she"), true, "keyword prefix 'she' matches");
assertEqual(localShellMatches(zsh, "x"), false, "non-matching single char does not match");
assertEqual(localShellMatches(zsh, "bash"), false, "different shell name does not match");

// selectLocalShellItems
assertEqual(selectLocalShellItems(all, ""), [{ shell: null }], "empty query -> single default");
assertEqual(selectLocalShellItems(all, "fish"), [{ shell: fish1 }], "query filters to matching shell");
assertEqual(selectLocalShellItems(all, "local"), [{ shell: zsh }, { shell: bash }, { shell: fish1 }], "keyword reveals all shells");
assertEqual(selectLocalShellItems(all, "zzz"), [], "no match -> empty");
assertEqual(selectLocalShellItems([], "local"), [{ shell: null }], "keyword with no detected shells -> default entry");
assertEqual(selectLocalShellItems([], "zzz"), [], "non-keyword with no detected shells -> empty");

// localShellNeedsPath (keyed by display label)
assertEqual([...localShellNeedsPath([zsh, bash, fish1])], [], "no collisions -> empty set");
assertEqual([...localShellNeedsPath([fish1, fish2, zsh])], ["Fish"], "duplicate name -> label flagged");

console.log("All newSessionItems local-shell tests passed.");
