import { getPlatform } from "@/utils/platform";
import { joinPath } from "./moveTargetCore";

// Mirrors the backend's `checked_remote_name`: a server picks these names, so
// `..`, a separator or a Windows drive would otherwise write outside the folder
// the user chose.

/** `name` is one plain path component. `windows` adds what Windows reads into
 *  a name: `\` separates, `C:` is a drive, and trailing dots and spaces are
 *  dropped, so `.. ` means `..`. */
export function isPlainName(name: string, windows: boolean): boolean {
  const dotsOnly = windows ? name.replace(/[. ]+$/, "") === "" : name === "" || name === "." || name === "..";
  const badChar = windows ? /[/\0\\:]/ : /[/\0]/;
  return !dotsOnly && !badChar.test(name);
}

/** Throws unless the server-given `name` is safe to create on this machine. */
export async function checkRemoteName(name: string): Promise<void> {
  if (!isPlainName(name, (await getPlatform()) === "windows")) {
    throw new Error(`Refusing unsafe file name from the server: ${JSON.stringify(name)}`);
  }
}

/** Local path for a server-given `name` inside `dir`; throws instead of escaping it. */
export async function localPathForRemoteName(dir: string, name: string): Promise<string> {
  await checkRemoteName(name);
  return joinPath(dir, name);
}
