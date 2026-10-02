const utf8 = new TextDecoder("utf-8", { fatal: true });
const ansi = new TextDecoder("windows-1252");

function decode(bytes: Uint8Array): string {
  try {
    return utf8.decode(bytes);
  } catch {
    return ansi.decode(bytes);
  }
}

function utf16Encoding(bytes: Uint8Array): "utf-16le" | "utf-16be" | undefined {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return "utf-16le";
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return "utf-16be";
  return undefined;
}

// Decoded per line: Windows tools such as ZOC mix UTF-8 and ANSI lines in one file.
export function decodeLegacyText(bytes: Uint8Array): string {
  const utf16 = utf16Encoding(bytes);
  if (utf16) return new TextDecoder(utf16).decode(bytes);
  try {
    return utf8.decode(bytes);
  } catch {
    const lines: string[] = [];
    let start = 0;
    for (let i = 0; i <= bytes.length; i++) {
      if (i === bytes.length || bytes[i] === 0x0a) {
        lines.push(decode(bytes.subarray(start, i)));
        start = i + 1;
      }
    }
    return lines.join("\n");
  }
}
