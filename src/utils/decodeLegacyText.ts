const utf8 = new TextDecoder("utf-8", { fatal: true });
const ansi = new TextDecoder("windows-1252");

function decode(bytes: Uint8Array): string {
  try {
    return utf8.decode(bytes);
  } catch {
    return ansi.decode(bytes);
  }
}

// Decoded per line: Windows tools such as ZOC mix UTF-8 and ANSI lines in one file.
export function decodeLegacyText(bytes: Uint8Array): string {
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
