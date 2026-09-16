import { describe, expect, test } from "vitest";
import { isAllowedLinkHref, normalizeNotes, sameNotes, sanitizePasteText, toggleTaskAtLine } from "./notesText";

describe("normalizeNotes", () => {
  test("blank becomes undefined, content is kept verbatim", () => {
    expect(normalizeNotes("")).toBeUndefined();
    expect(normalizeNotes("  \n\t")).toBeUndefined();
    expect(normalizeNotes("  keep  ")).toBe("  keep  ");
  });
});

describe("sameNotes", () => {
  test("undefined, empty and whitespace are equal; content compares exactly", () => {
    expect(sameNotes(undefined, "  ")).toBe(true);
    expect(sameNotes("a", "a")).toBe(true);
    expect(sameNotes("a", "a ")).toBe(false);
  });
});

describe("toggleTaskAtLine", () => {
  const src = "# T\n- [ ] one\n  * [x] two\n1. [X] three\nplain";
  test("checks an unchecked item", () => {
    expect(toggleTaskAtLine(src, 2).split("\n")[1]).toBe("- [x] one");
  });
  test("unchecks nested and ordered items", () => {
    expect(toggleTaskAtLine(src, 3).split("\n")[2]).toBe("  * [ ] two");
    expect(toggleTaskAtLine(src, 4).split("\n")[3]).toBe("1. [ ] three");
  });
  test("leaves non-task lines and out-of-range lines untouched", () => {
    expect(toggleTaskAtLine(src, 5)).toBe(src);
    expect(toggleTaskAtLine(src, 99)).toBe(src);
  });
  test("toggles tasks inside blockquotes, including nested and tight markers", () => {
    expect(toggleTaskAtLine("> - [ ] quoted", 1)).toBe("> - [x] quoted");
    expect(toggleTaskAtLine("> > 1. [x] deep", 1)).toBe("> > 1. [ ] deep");
    expect(toggleTaskAtLine("  >>- [ ] tight", 1)).toBe("  >>- [x] tight");
    expect(toggleTaskAtLine("> plain [ ] text", 1)).toBe("> plain [ ] text");
  });
  test("keeps CRLF line endings", () => {
    expect(toggleTaskAtLine("a\r\n- [ ] b\r\n", 2)).toBe("a\r\n- [x] b\r\n");
  });
});

describe("isAllowedLinkHref", () => {
  test.each(["https://x.io", "http://10.0.0.1:8080/a", "mailto:ops@x.io"])("allows %s", (href) => {
    expect(isAllowedLinkHref(href)).toBe(true);
  });
  test.each(["javascript:alert(1)", "file:///etc/passwd", "data:text/html,x", "ssh://h", "relative/path", "", undefined, null])(
    "rejects %s",
    (href) => {
      expect(isAllowedLinkHref(href)).toBe(false);
    },
  );
});

describe("sanitizePasteText", () => {
  test("keeps printable text, tabs and newlines", () => {
    expect(sanitizePasteText("ls -la\tfoo\ncd /tmp && echo \"é ✓\"")).toBe("ls -la\tfoo\ncd /tmp && echo \"é ✓\"");
  });
  test("turns CR and CRLF into newlines", () => {
    expect(sanitizePasteText("a\r\nb\rc")).toBe("a\nb\nc");
  });
  test("strips every other C0 control, DEL and C1 controls", () => {
    const c0 = Array.from({ length: 32 }, (_, i) => String.fromCharCode(i)).filter((c) => c !== "\t" && c !== "\n" && c !== "\r").join("");
    const c1 = Array.from({ length: 32 }, (_, i) => String.fromCharCode(0x80 + i)).join("");
    expect(sanitizePasteText(`x${c0}\x7f${c1}y`)).toBe("xy");
  });
  test("cannot smuggle a bracketed-paste terminator or hidden line edits", () => {
    expect(sanitizePasteText("echo safe\x1b[201~\x15rm -rf ~\x0f")).toBe("echo safe[201~rm -rf ~");
    expect(sanitizePasteText("a\x9b201~b")).toBe("a201~b");
  });
});
