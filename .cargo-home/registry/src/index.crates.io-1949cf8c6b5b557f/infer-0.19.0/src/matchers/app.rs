/// Returns whether a buffer is a wasm.
///
/// # Examples
///
/// ```rust
/// use std::fs;
/// assert!(infer::app::is_wasm(&fs::read("testdata/sample.wasm").unwrap()));
/// ```
pub fn is_wasm(buf: &[u8]) -> bool {
    // WASM has starts with `\0asm`, followed by the version.
    // http://webassembly.github.io/spec/core/binary/modules.html#binary-magic
    buf.len() >= 8
        && buf[0] == 0x00
        && buf[1] == 0x61
        && buf[2] == 0x73
        && buf[3] == 0x6D
        && buf[4] == 0x01
        && buf[5] == 0x00
        && buf[6] == 0x00
        && buf[7] == 0x00
}

/// Returns whether a buffer is an EXE. DLL and EXE have the same magic number, so returns true also for a DLL.
///
/// # Example
///
/// ```rust
/// use std::fs;
/// assert!(infer::app::is_exe(&fs::read("testdata/sample.exe").unwrap()));
/// ```
pub fn is_exe(buf: &[u8]) -> bool {
    buf.len() > 1 && buf[0] == 0x4D && buf[1] == 0x5A
}

/// Returns whether a buffer is a DLL. DLL and EXE have the same magic number, so returns true also for an EXE.
pub fn is_dll(buf: &[u8]) -> bool {
    is_exe(buf)
}

/// Returns whether a buffer is an ELF.
pub fn is_elf(buf: &[u8]) -> bool {
    buf.len() > 52 && buf[0] == 0x7F && buf[1] == 0x45 && buf[2] == 0x4C && buf[3] == 0x46
}

/// Returns whether a buffer is compiled Java bytecode.
pub fn is_java(buf: &[u8]) -> bool {
    if buf.len() < 8 || [0xca, 0xfe, 0xba, 0xbe] != buf[0..4] {
        return false;
    }

    //Checking the next 4 bytes are greater than or equal to 45 to distinguish from Mach-O binaries
    //Mach-O "Fat" binaries also use 0xCAFEBABE as magic bytes to start the file
    //Java are always Big Endian, after the magic bytes there are 2 bytes for the class file's
    //minor version and then 2 bytes for the major version
    //https://docs.oracle.com/javase/specs/jvms/se20/html/jvms-4.html
    let minor_major_bytes = [buf[4], buf[5], buf[6], buf[7]];
    if u32::from_be_bytes(minor_major_bytes) < 45 {
        //Java class files start at a major version of 45 and a minor of 0
        //So a value less than this shouldn't be a Java class file
        return false;
    }
    //For due dillegence confirm that the major bytes are greater than or equal to 45
    u16::from_be_bytes([buf[6], buf[7]]) >= 45
}

/// Returns whether a buffer is LLVM Bitcode.
pub fn is_llvm(buf: &[u8]) -> bool {
    buf.len() >= 2 && buf[0] == 0x42 && buf[1] == 0x43
}

/// Returns whether a buffer is a Mach-O binary.
pub fn is_mach(buf: &[u8]) -> bool {
    // Mach-O binaries can be one of four variants: x86, x64, PowerPC, "Fat" (x86 + PowerPC)
    // https://ilostmynotes.blogspot.com/2014/05/mach-o-filetype-identification.html

    if buf.len() < 4 {
        return false;
    }

    match buf[0..4] {
        [width, 0xfa, 0xed, 0xfe] if width == 0xcf || width == 0xce => true,
        [0xfe, 0xed, 0xfa, width] if width == 0xcf || width == 0xce => true,
        [0xca, 0xfe, 0xba, 0xbe] if buf.len() >= 8 => {
            //Checking the next 4 bytes are less than 45 to distinguish from Java class files
            //which also use 0xCAFEBABE as magic bytes
            //Fat Mach-O binaries are always Big Endian
            u32::from_be_bytes([buf[4], buf[5], buf[6], buf[7]]) < 45
        }
        _ => false,
    }
}

/// Returns whether a buffer is a Dalvik Executable (DEX).
pub fn is_dex(buf: &[u8]) -> bool {
    // https://source.android.com/devices/tech/dalvik/dex-format#dex-file-magic

    buf.len() > 36
    // magic
    && buf[0] == 0x64 && buf[1] == 0x65 && buf[2] == 0x78 && buf[3] == 0x0A
    // file sise
    && buf[36] == 0x70
}

/// Returns whether a buffer is a Dey Optimized Dalvik Executable (ODEX).
pub fn is_dey(buf: &[u8]) -> bool {
    buf.len() > 100
    // magic
    && buf[0] == 0x64 && buf[1] == 0x65 && buf[2] == 0x79 && buf[3] == 0x0A
    // file sise
    && is_dex(&buf[40..100])
}

/// Returns whether a buffer DER encoded X.509 certificate.
pub fn is_der(buf: &[u8]) -> bool {
    // https://en.wikipedia.org/wiki/List_of_file_signatures
    // https://github.com/ReFirmLabs/binwalk/blob/master/src/binwalk/magic/crypto#L25-L37
    // https://www.digitalocean.com/community/tutorials/openssl-essentials-working-with-ssl-certificates-private-keys-and-csrs
    // openssl req -newkey rsa:2048 -nodes -keyout domain.key -x509 -days 1 -out domain.crt
    // openssl x509 -in domain.crt -outform der -out domain.der

    buf.len() > 2 && buf[0] == 0x30 && buf[1] == 0x82
}

/// Returns whether a buffer is a Common Object File Format for i386 architecture.
pub fn is_coff_i386(buf: &[u8]) -> bool {
    buf.len() > 2 && buf[0] == 0x4C && buf[1] == 0x01
}

/// Returns whether a buffer is a Common Object File Format for x64 architecture.
pub fn is_coff_x64(buf: &[u8]) -> bool {
    buf.len() > 2 && buf[0] == 0x64 && buf[1] == 0x86
}

/// Returns whether a buffer is a Common Object File Format for Itanium architecture.
pub fn is_coff_ia64(buf: &[u8]) -> bool {
    buf.len() > 2 && buf[0] == 0x00 && buf[1] == 0x02
}

/// Returns whether a buffer is a Common Object File Format.
pub fn is_coff(buf: &[u8]) -> bool {
    is_coff_x64(buf) || is_coff_i386(buf) || is_coff_ia64(buf)
}

/// Returns whether a buffer is pem
pub fn is_pem(buf: &[u8]) -> bool {
    // https://en.wikipedia.org/wiki/List_of_file_signatures
    buf.len() > 11
        && buf[0] == b'-'
        && buf[1] == b'-'
        && buf[2] == b'-'
        && buf[3] == b'-'
        && buf[4] == b'-'
        && buf[5] == b'B'
        && buf[6] == b'E'
        && buf[7] == b'G'
        && buf[8] == b'I'
        && buf[9] == b'N'
        && buf[10] == b' '
}
