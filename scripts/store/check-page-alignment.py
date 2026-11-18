"""Fails unless every native library in an .aab or .apk loads on 16 KB page devices (Google Play requirement)."""
import struct
import sys
import zipfile

PAGE = 16 * 1024


def load_alignments(elf: bytes) -> list[int]:
    phoff = struct.unpack_from("<Q", elf, 0x20)[0]
    phentsize, phnum = struct.unpack_from("<HH", elf, 0x36)
    out = []
    for i in range(phnum):
        entry = phoff + i * phentsize
        if struct.unpack_from("<I", elf, entry)[0] == 1:  # PT_LOAD
            out.append(struct.unpack_from("<Q", elf, entry + 0x30)[0])
    return out


def main(path: str) -> int:
    bad = []
    with zipfile.ZipFile(path) as z:
        libs = [n for n in z.namelist() if n.endswith(".so") and "/arm64-v8a/" in n]
        for name in libs:
            aligns = load_alignments(z.read(name))
            status = "ok" if all(a >= PAGE for a in aligns) else "NOT 16 KB aligned"
            print(f"{name}: LOAD align {sorted({hex(a) for a in aligns})} {status}")
            if status != "ok":
                bad.append(name)
    if not libs:
        print("no arm64-v8a native library found", file=sys.stderr)
        return 1
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
