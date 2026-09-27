import { getPlatform } from "@/utils/platform";

/** Mirrors the backend's `is_plain_name`: on Windows `\` separates, `C:` is a drive, and `.. ` reads as `..`. */
export function isPlainName(name: string, windows: boolean): boolean {
  const dotsOnly = windows ? name.replace(/[. ]+$/, "") === "" : name === "" || name === "." || name === "..";
  const badChar = windows ? /[/\0\\:]/ : /[/\0]/;
  return !dotsOnly && !badChar.test(name);
}

export async function checkRemoteName(name: string): Promise<void> {
  if (!isPlainName(name, (await getPlatform()) === "windows")) {
    throw new Error(`Refusing unsafe file name from the server: ${JSON.stringify(name)}`);
  }
}
