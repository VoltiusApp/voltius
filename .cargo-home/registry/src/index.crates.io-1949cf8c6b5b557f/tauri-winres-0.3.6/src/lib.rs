//! Rust Windows resource helper
//!
//! This crate implements a simple generator for Windows resource (.rc) files
//! for use with either Microsoft `rc.exe` resource compiler or with GNU `windres.exe`
//!
//! The [`WindowsResorce::compile()`] method is intended to be used from a build script and
//! needs environment variables from cargo to be set. It not only compiles the resource
//! but directs cargo to link the resource compiler's output.
//!
//! # Example
//!
//! ```rust
//! # use std::io;
//! # fn test_main() -> io::Result<()> {
//! if cfg!(target_os = "windows") {
//!     let mut res = tauri_winres::WindowsResource::new();
//!     res.set_icon("test.ico")
//! #      .set_output_directory(".")
//!        .set("InternalName", "TEST.EXE")
//!        // manually set version 1.0.0.0
//!        .set_version_info(tauri_winres::VersionInfo::PRODUCTVERSION, 0x0001000000000000);
//!     res.compile()?;
//! }
//! # Ok(())
//! # }
//! ```
//!
//! # Defaults
//!
//! We try to guess some sensible default values from Cargo's build time environement variables
//! This is described in [`WindowsResource::new()`]. Furthermore we have to know where to find the
//! resource compiler for the MSVC Toolkit. This can be done by looking up a registry key but
//! for MinGW this has to be done manually.
//!
//! The following paths are the hardcoded defaults:
//! MSVC the last registry key at
//! `HKLM\SOFTWARE\Microsoft\Windows Kits\Installed Roots`, for MinGW we try our luck by simply
//! using the `%PATH%` environment variable.
//!
//! Note that the toolkit bitness as to match the one from the current Rust compiler. If you are
//! using Rust GNU 64-bit you have to use MinGW64. For MSVC this is simpler as (recent) Windows
//! SDK always installs both versions on a 64-bit system.
//!
//! [`WindowsResorce::compile()`]: struct.WindowsResource.html#method.compile
//! [`WindowsResource::new()`]: struct.WindowsResource.html#method.new

mod helpers;

use std::collections::BTreeMap;
use std::env;
use std::fs;
use std::io;
use std::io::prelude::*;
use std::path::{Path, PathBuf};

use helpers::{escape_string, parse_cargo_toml};

/// Version info field names
#[derive(PartialEq, Eq, Hash, Debug, PartialOrd, Ord)]
pub enum VersionInfo {
    /// The version value consists of four 16 bit words, e.g.,
    /// `MAJOR << 48 | MINOR << 32 | PATCH << 16 | RELEASE`
    FILEVERSION,
    /// The version value consists of four 16 bit words, e.g.,
    /// `MAJOR << 48 | MINOR << 32 | PATCH << 16 | RELEASE`
    PRODUCTVERSION,
    /// Should be Windows NT Win32, with value `0x40004`
    FILEOS,
    /// The value (for a rust compiler output) should be
    /// 1 for a EXE and 2 for a DLL
    FILETYPE,
    /// Only for Windows drivers
    FILESUBTYPE,
    /// Bit mask for FILEFLAGS
    FILEFLAGSMASK,
    /// Only the bits set in FILEFLAGSMASK are read
    FILEFLAGS,
}

#[derive(Debug)]
struct Icon {
    path: String,
    name_id: String,
}

#[derive(Debug)]
pub struct WindowsResource {
    properties: BTreeMap<String, String>,
    version_info: BTreeMap<VersionInfo, u64>,
    rc_file: Option<String>,
    icons: Vec<Icon>,
    language: u16,
    manifest: Option<String>,
    manifest_file: Option<String>,
    append_rc_content: String,
}

#[allow(clippy::new_without_default)]
impl WindowsResource {
    /// Create a new resource with version info struct
    ///
    ///
    /// We initialize the resource file with values provided by cargo
    ///
    /// | Field                | Cargo / Values               |
    /// |----------------------|------------------------------|
    /// | `"FileVersion"`      | `package.version`            |
    /// | `"ProductVersion"`   | `package.version`            |
    /// | `"ProductName"`      | `package.name`               |
    /// | `"FileDescription"`  | `package.description`        |
    ///
    /// Furthermore if a section `package.metadata.tauri-winres` exists
    /// in `Cargo.toml` it will be parsed. Values in this section take precedence
    /// over the values provided natively by cargo. Only the string table
    /// of the version struct can be set this way.
    /// Additionally, the language field is set to neutral (i.e. `0`)
    /// and no icon is set. These settings have to be done programmatically.
    ///
    /// `Cargo.toml` files have to be written in UTF-8, so we support all valid UTF-8 strings
    /// provided.
    ///
    /// ```,toml
    /// #Cargo.toml
    /// [package.metadata.tauri-winres]
    /// OriginalFilename = "testing.exe"
    /// FileDescription = "⛄❤☕"
    /// LegalCopyright = "Copyright © 2016"
    /// ```
    ///
    /// The version info struct is set to some values
    /// sensible for creating an executable file.
    ///
    /// | Property             | Cargo / Values               |
    /// |----------------------|------------------------------|
    /// | `FILEVERSION`        | `package.version`            |
    /// | `PRODUCTVERSION`     | `package.version`            |
    /// | `FILEOS`             | `VOS_NT_WINDOWS32 (0x40004)` |
    /// | `FILETYPE`           | `VFT_APP (0x1)`              |
    /// | `FILESUBTYPE`        | `VFT2_UNKNOWN (0x0)`         |
    /// | `FILEFLAGSMASK`      | `VS_FFI_FILEFLAGSMASK (0x3F)`|
    /// | `FILEFLAGS`          | `0x0`                        |
    ///
    pub fn new() -> Self {
        let mut props: BTreeMap<String, String> = BTreeMap::new();
        let mut ver: BTreeMap<VersionInfo, u64> = BTreeMap::new();

        props.insert(
            "FileVersion".to_string(),
            env::var("CARGO_PKG_VERSION").unwrap(),
        );
        props.insert(
            "ProductVersion".to_string(),
            env::var("CARGO_PKG_VERSION").unwrap(),
        );
        props.insert(
            "ProductName".to_string(),
            env::var("CARGO_PKG_NAME").unwrap(),
        );
        // If there is no description, fallback to name
        let description = if let Ok(description) = env::var("CARGO_PKG_DESCRIPTION") {
            if !description.is_empty() {
                description
            } else {
                env::var("CARGO_PKG_NAME").unwrap()
            }
        } else {
            env::var("CARGO_PKG_NAME").unwrap()
        };
        props.insert("FileDescription".to_string(), description);

        parse_cargo_toml(&mut props).unwrap();

        let mut version = 0_u64;
        version |= env::var("CARGO_PKG_VERSION_MAJOR")
            .unwrap()
            .parse()
            .unwrap_or(0)
            << 48;
        version |= env::var("CARGO_PKG_VERSION_MINOR")
            .unwrap()
            .parse()
            .unwrap_or(0)
            << 32;
        version |= env::var("CARGO_PKG_VERSION_PATCH")
            .unwrap()
            .parse()
            .unwrap_or(0)
            << 16;
        // version |= env::var("CARGO_PKG_VERSION_PRE").unwrap().parse().unwrap_or(0);
        ver.insert(VersionInfo::FILEVERSION, version);
        ver.insert(VersionInfo::PRODUCTVERSION, version);
        ver.insert(VersionInfo::FILEOS, 0x00040004);
        ver.insert(VersionInfo::FILETYPE, 1);
        ver.insert(VersionInfo::FILESUBTYPE, 0);
        ver.insert(VersionInfo::FILEFLAGSMASK, 0x3F);
        ver.insert(VersionInfo::FILEFLAGS, 0);

        WindowsResource {
            properties: props,
            version_info: ver,
            rc_file: None,
            icons: Vec::new(),
            language: 0,
            manifest: None,
            manifest_file: None,
            append_rc_content: String::new(),
        }
    }

    /// Set string properties of the version info struct.
    ///
    /// Possible field names are:
    ///
    ///  - `"FileVersion"`
    ///  - `"FileDescription"`
    ///  - `"ProductVersion"`
    ///  - `"ProductName"`
    ///  - `"OriginalFilename"`
    ///  - `"LegalCopyright"`
    ///  - `"LegalTrademark"`
    ///  - `"CompanyName"`
    ///  - `"Comments"`
    ///  - `"InternalName"`
    ///
    /// Additionally there exists
    /// `"PrivateBuild"`, `"SpecialBuild"`
    /// which should only be set, when the `FILEFLAGS` property is set to
    /// `VS_FF_PRIVATEBUILD(0x08)` or `VS_FF_SPECIALBUILD(0x20)`
    ///
    /// It is possible to use arbirtrary field names but Windows Explorer and other
    /// tools might not show them.
    pub fn set<'a>(&mut self, name: &'a str, value: &'a str) -> &mut Self {
        self.properties.insert(name.to_string(), value.to_string());
        self
    }

    /// Set the user interface language of the file
    ///
    /// # Example
    ///
    /// ```rust,compile_fail
    /// # use std::io;
    /// fn main() {
    ///   if cfg!(target_os = "windows") {
    ///     let mut res = tauri_winres::WindowsResource::new();
    /// #   res.set_output_directory(".");
    ///     res.set_language(winapi::um::winnt::MAKELANGID(
    ///         winapi::um::winnt::LANG_ENGLISH,
    ///         winapi::um::winnt::SUBLANG_ENGLISH_US
    ///     ));
    ///     res.compile().unwrap();
    ///   }
    /// }
    /// ```
    /// For possible values look at the `winapi::um::winnt` constants, specifically those
    /// starting with `LANG_` and `SUBLANG_`.
    ///
    /// [`MAKELANGID`]: https://docs.rs/winapi/0.3/x86_64-pc-windows-msvc/winapi/um/winnt/fn.MAKELANGID.html
    /// [`winapi::um::winnt`]: https://docs.rs/winapi/0.3/x86_64-pc-windows-msvc/winapi/um/winnt/index.html#constants
    ///
    /// # Table
    /// Sometimes it is just simpler to specify the numeric constant directly
    /// (That is what most `.rc` files do).
    /// For possible values take a look at the MSDN page for resource files;
    /// we only listed some values here.
    ///
    /// | Language            | Value    |
    /// |---------------------|----------|
    /// | Neutral             | `0x0000` |
    /// | English             | `0x0009` |
    /// | English (US)        | `0x0409` |
    /// | English (GB)        | `0x0809` |
    /// | German              | `0x0407` |
    /// | German (AT)         | `0x0c07` |
    /// | French              | `0x000c` |
    /// | French (FR)         | `0x040c` |
    /// | Catalan             | `0x0003` |
    /// | Basque              | `0x042d` |
    /// | Breton              | `0x007e` |
    /// | Scottish Gaelic     | `0x0091` |
    /// | Romansch            | `0x0017` |
    pub fn set_language(&mut self, language: u16) -> &mut Self {
        self.language = language;
        self
    }

    /// Add an icon with nameID `32512`.
    ///
    /// This icon needs to be in `ico` format. The filename can be absolute
    /// or relative to the projects root.
    ///
    /// Equivalent to `set_icon_with_id(path, "32512")`.
    ///
    /// The reason for `32512` is that we misunderstood `IDI_APPLICATION` (`MAKEINTRESOURCE(32512)`)
    /// should be used for the application icon, which is not true.
    /// See <https://github.com/mxre/winres/issues/28>
    ///
    /// Quote from [Old New Things](https://devblogs.microsoft.com/oldnewthing/20250423-00/?p=111106)
    ///
    /// > Recall the algorithm by which Explorer finds the “first” icon in a file.
    /// >
    /// > - Choose the alphabetically first named group icon, if available.
    /// > - Else, choose the group icon with the numerically lowest identifier.
    pub fn set_icon(&mut self, path: &str) -> &mut Self {
        self.set_icon_with_id(path, "32512")
    }

    /// Add an icon with the specified name ID.
    ///
    /// This icon need to be in `ico` format. The path can be absolute or
    /// relative to the projects root.
    ///
    /// ## Name ID and Icon Loading
    ///
    /// The name ID can be (the string representation of) a 16-bit unsigned
    /// integer, or some other string.
    ///
    /// You should not add multiple icons with the same name ID. It will result
    /// in a build failure.
    ///
    /// When the name ID is an integer, the icon can be loaded at runtime with
    ///
    /// ```ignore
    /// LoadIconW(h_instance, MAKEINTRESOURCEW(name_id_as_integer))
    /// ```
    ///
    /// Otherwise, it can be loaded with
    ///
    /// ```ignore
    /// LoadIconW(h_instance, name_id_as_wide_c_str_as_ptr)
    /// ```
    ///
    /// Where `h_instance` is the module handle of the current executable
    /// ([`GetModuleHandleW`](https://docs.rs/winapi/0.3.8/winapi/um/libloaderapi/fn.GetModuleHandleW.html)`(null())`),
    /// [`LoadIconW`](https://docs.rs/winapi/0.3.8/winapi/um/winuser/fn.LoadIconW.html)
    /// and
    /// [`MAKEINTRESOURCEW`](https://docs.rs/winapi/0.3.8/winapi/um/winuser/fn.MAKEINTRESOURCEW.html)
    /// are defined in winapi.
    ///
    /// ## Multiple Icons, Which One is Application Icon?
    ///
    /// When you have multiple icons, it's a bit complicated which one will be
    /// chosen as the application icon:
    /// <https://docs.microsoft.com/en-us/previous-versions/ms997538(v=msdn.10)?redirectedfrom=MSDN#choosing-an-icon>.
    ///
    /// To keep things simple, we recommand you use only 16-bit unsigned integer
    /// name IDs, and add the application icon first with the lowest id:
    ///
    /// ```nocheck
    /// res.set_icon("icon.ico") // This is application icon.
    ///    .set_icon_with_id("icon2.icon", "2")
    ///    .set_icon_with_id("icon3.icon", "3")
    ///    // ...
    /// ```
    pub fn set_icon_with_id<'a>(&mut self, path: &'a str, name_id: &'a str) -> &mut Self {
        self.icons.push(Icon {
            path: dunce::canonicalize(path)
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or(path.to_string()),
            name_id: name_id.into(),
        });
        self
    }

    /// Set a version info struct property
    /// Currently we only support numeric values; you have to look them up.
    pub fn set_version_info(&mut self, field: VersionInfo, value: u64) -> &mut Self {
        self.version_info.insert(field, value);
        self
    }

    /// Set the embedded manifest file
    ///
    /// # Example
    ///
    /// The following manifest will brand the exe as requesting administrator privileges.
    /// Thus, everytime it is executed, a Windows UAC dialog will appear.
    ///
    /// ```rust
    /// let mut res = tauri_winres::WindowsResource::new();
    /// res.set_manifest(r#"
    /// <assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
    /// <trustInfo xmlns="urn:schemas-microsoft-com:asm.v3">
    ///     <security>
    ///         <requestedPrivileges>
    ///             <requestedExecutionLevel level="requireAdministrator" uiAccess="false" />
    ///         </requestedPrivileges>
    ///     </security>
    /// </trustInfo>
    /// </assembly>
    /// "#);
    /// ```
    pub fn set_manifest(&mut self, manifest: &str) -> &mut Self {
        self.manifest_file = None;
        self.manifest = Some(manifest.to_string());
        self
    }

    /// Some as [`set_manifest()`] but a filename can be provided and
    /// file is included by the resource compieler itself.
    /// This method works the same way as [`set_icon()`]
    ///
    /// [`set_manifest()`]: #method.set_manifest
    /// [`set_icon()`]: #method.set_icon
    pub fn set_manifest_file(&mut self, file: &str) -> &mut Self {
        self.manifest_file = Some(file.to_string());
        self.manifest = None;
        self
    }

    /// Write a resource file with the set values
    pub fn write_resource_file<P: AsRef<Path>>(&self, path: P) -> io::Result<()> {
        let mut f = fs::File::create(path)?;

        // use UTF8 as an encoding
        // this makes it easier since in rust all string are UTF8
        writeln!(f, "#pragma code_page(65001)")?;
        writeln!(f, "1 VERSIONINFO")?;
        for (k, v) in self.version_info.iter() {
            match *k {
                VersionInfo::FILEVERSION | VersionInfo::PRODUCTVERSION => writeln!(
                    f,
                    "{:?} {}, {}, {}, {}",
                    k,
                    (*v >> 48) as u16,
                    (*v >> 32) as u16,
                    (*v >> 16) as u16,
                    *v as u16
                )?,
                _ => writeln!(f, "{:?} {:#x}", k, v)?,
            };
        }
        writeln!(f, "{{\nBLOCK \"StringFileInfo\"")?;
        writeln!(f, "{{\nBLOCK \"{:04x}04b0\"\n{{", self.language)?;
        for (k, v) in self.properties.iter() {
            if !v.is_empty() {
                writeln!(
                    f,
                    "VALUE \"{}\", \"{}\"",
                    escape_string(k),
                    escape_string(v)
                )?;
            }
        }
        writeln!(f, "}}\n}}")?;

        writeln!(f, "BLOCK \"VarFileInfo\" {{")?;
        writeln!(f, "VALUE \"Translation\", {:#x}, 0x04b0", self.language)?;
        writeln!(f, "}}\n}}")?;
        for icon in &self.icons {
            writeln!(
                f,
                "{} ICON \"{}\"",
                escape_string(&icon.name_id),
                escape_string(&icon.path)
            )?;
        }
        if let Some(e) = self.version_info.get(&VersionInfo::FILETYPE) {
            if let Some(manf) = self.manifest.as_ref() {
                writeln!(f, "{} 24", e)?;
                writeln!(f, "{{")?;
                for line in manf.lines() {
                    writeln!(f, "\" {} \"", escape_string(line.trim()))?;
                }
                writeln!(f, "}}")?;
            } else if let Some(manf) = self.manifest_file.as_ref() {
                writeln!(f, "{} 24 \"{}\"", e, escape_string(manf))?;
            }
        }
        writeln!(f, "{}", self.append_rc_content)?;
        Ok(())
    }

    /// Set a path to an already existing resource file.
    ///
    /// We will neither modify this file nor parse its contents. This function
    /// simply replaces the internaly generated resource file that is passed to
    /// the compiler. You can use this function to write a resource file yourself.
    pub fn set_resource_file(&mut self, path: &str) -> &mut Self {
        self.rc_file = Some(path.to_string());
        self
    }

    /// Append an additional snippet to the generated rc file.
    ///
    /// # Example
    ///
    /// Define a menu resource:
    ///
    /// ```rust,no_run
    /// # if cfg!(target_os = "windows") {
    ///     let mut res = tauri_winres::WindowsResource::new();
    ///     res.append_rc_content(r##"sample MENU
    /// {
    ///     MENUITEM "&Soup", 100
    ///     MENUITEM "S&alad", 101
    ///     POPUP "&Entree"
    ///     {
    ///          MENUITEM "&Fish", 200
    ///          MENUITEM "&Chicken", 201, CHECKED
    ///          POPUP "&Beef"
    ///          {
    ///               MENUITEM "&Steak", 301
    ///               MENUITEM "&Prime Rib", 302
    ///          }
    ///     }
    ///     MENUITEM "&Dessert", 103
    /// }"##);
    /// #    res.compile()?;
    /// # }
    /// # Ok::<_, std::io::Error>(())
    /// ```
    pub fn append_rc_content(&mut self, content: &str) -> &mut Self {
        if !(self.append_rc_content.ends_with('\n') || self.append_rc_content.is_empty()) {
            self.append_rc_content.push('\n');
        }
        self.append_rc_content.push_str(content);
        self
    }

    /// Run the resource compiler
    ///
    /// This function generates a resource file from the settings or
    /// uses an existing resource file and passes it to the resource compiler
    /// of your toolkit.
    ///
    /// Further more we will print the correct statements for
    /// `cargo:rustc-link-lib=` and `cargo:rustc-link-search` on the console,
    /// so that the cargo build script can link the compiled resource file.
    pub fn compile(&self) -> io::Result<()> {
        let output = PathBuf::from(env::var("OUT_DIR").unwrap_or_else(|_| ".".to_string()));
        let rc = output.join("resource.rc");

        if let Some(s) = self.rc_file.as_ref() {
            fs::write(&rc, s)?;
        } else {
            self.write_resource_file(&rc)?;
        }

        // This matches v2 behavior
        embed_resource::compile(rc, embed_resource::NONE)
            .manifest_required()
            .unwrap();

        Ok(())
    }

    /// Run the resource compiler
    ///
    /// This function generates a resource file from the settings or
    /// uses an existing resource file and passes it to the resource compiler
    /// of your toolkit.
    ///
    /// Further more we will print the correct statements for
    /// `cargo:rustc-link-lib=` and `cargo:rustc-link-search` on the console,
    /// so that the cargo build script can link the compiled resource file.
    pub fn compile_for(&self, binaries: &[&str]) -> io::Result<()> {
        let output = PathBuf::from(env::var("OUT_DIR").unwrap_or_else(|_| ".".to_string()));
        let rc = output.join("resource.rc");

        if let Some(s) = self.rc_file.as_ref() {
            fs::write(&rc, s)?;
        } else {
            self.write_resource_file(&rc)?;
        }

        // This matches v2 behavior
        embed_resource::compile_for(rc, binaries, embed_resource::NONE)
            .manifest_required()
            .unwrap();

        Ok(())
    }
}

// Deprecated functions
impl WindowsResource {
    #[deprecated(
        since = "0.1.1",
        note = "This function is no-op! It is now handled by the embed-resource crate."
    )]
    pub fn set_toolkit_path(&mut self, _path: &str) -> &mut Self {
        self
    }

    #[deprecated(
        since = "0.1.1",
        note = "This function is no-op! It is now handled by the embed-resource crate."
    )]
    pub fn set_windres_path(&mut self, _path: &str) -> &mut Self {
        self
    }

    #[deprecated(
        since = "0.1.1",
        note = "This function is no-op! It is now handled by the embed-resource crate."
    )]
    pub fn set_ar_path(&mut self, _path: &str) -> &mut Self {
        self
    }

    #[deprecated(
        since = "0.1.1",
        note = "This function is no-op! It is now handled by the embed-resource crate."
    )]
    pub fn add_toolkit_include(&mut self, _add: bool) -> &mut Self {
        self
    }

    #[deprecated(
        since = "0.1.1",
        note = "This function is no-op! It is now handled by the embed-resource crate."
    )]
    pub fn set_output_directory(&mut self, _path: &str) -> &mut Self {
        self
    }
}

#[cfg(test)]
mod tests {
    use super::helpers::escape_string;

    #[test]
    fn string_escaping() {
        assert_eq!(&escape_string(""), "");
        assert_eq!(&escape_string("foo"), "foo");
        assert_eq!(&escape_string(r#""Hello""#), r#"""Hello"""#);
        assert_eq!(
            &escape_string(r"C:\Program Files\Foobar"),
            r"C:\\Program Files\\Foobar"
        );
    }
}
