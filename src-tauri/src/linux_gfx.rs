//! Linux-only startup workarounds for WebKitGTK rendering failures (white or
//! blank window), applied before anything touches GTK/WebKit.
//!
//! Two independent, well-documented failure modes are addressed. Both hit
//! AppImage builds almost exclusively — deb/rpm installs use the system
//! WebKitGTK stack and are fine:
//!
//! 1. WebKitGTK >= 2.42 composites through DMA-BUF by default. That path is
//!    broken on NVIDIA proprietary drivers and on various Mesa/compositor
//!    combinations; WebKit silently renders nothing and the window stays
//!    white. The ecosystem-standard fix is `WEBKIT_DISABLE_DMABUF_RENDERER=1`,
//!    which falls back to the older (still GPU-accelerated) EGL path. That
//!    path presents WebGL canvases one frame late (#224), so on native
//!    Wayland + NVIDIA we keep DMA-BUF and set `__NV_DISABLE_EXPLICIT_SYNC=1`
//!    instead: the failure there is a `wp_linux_drm_syncobj_surface_v1`
//!    protocol error ("no acquire point") that kills the connection.
//!
//! 2. linuxdeploy bundles the build machine's `libwayland-client.so.0` into
//!    the AppImage as a WebKit dependency. On hosts with a newer Wayland
//!    stack (Arch/CachyOS/Fedora) the bundled copy wins the link order and
//!    EGL display creation fails ("Could not create default EGL display:
//!    EGL_BAD_PARAMETER") — another white window — or GTK silently falls
//!    back to X11/Xwayland (blurry scaling, janky rendering). The fix is to
//!    re-exec once with the system `libwayland-client` in `LD_PRELOAD` so it
//!    beats the bundled copy.
//!
//! Env vars already set by the user are always respected, and
//! `VOLTIUS_NO_LINUX_GFX_WORKAROUNDS=1` disables everything here.

use std::env;
use std::ffi::OsStr;
use std::io::Read;
use std::path::{Path, PathBuf};

const OPT_OUT: &str = "VOLTIUS_NO_LINUX_GFX_WORKAROUNDS";
const NV_DISABLE_EXPLICIT_SYNC: &str = "__NV_DISABLE_EXPLICIT_SYNC";
/// Marks the re-exec'd process so a failed preload can't retry forever.
const PRELOAD_GUARD: &str = "VOLTIUS_WAYLAND_PRELOAD_ATTEMPTED";

/// System locations of libwayland-client, most specific first: Debian/Ubuntu
/// multiarch, then Fedora/openSUSE lib64, then Arch-style /usr/lib.
const WAYLAND_CLIENT_CANDIDATES: &[&str] = &[
    "/usr/lib/x86_64-linux-gnu/libwayland-client.so.0",
    "/usr/lib/aarch64-linux-gnu/libwayland-client.so.0",
    "/usr/lib64/libwayland-client.so.0",
    "/lib64/libwayland-client.so.0",
    "/usr/lib/libwayland-client.so.0",
    "/usr/lib/libwayland-client.so",
];

/// Must run first thing in `run()`: the env vars have to be in place before
/// WebKit initializes, and the re-exec path must happen before any threads
/// are spawned (exec'ing a multi-threaded process leaks the other threads).
pub fn apply_startup_workarounds() {
    if env::var_os(OPT_OUT).is_some() {
        return;
    }

    let appimage = env::var_os("APPIMAGE").is_some() || env::var_os("APPDIR").is_some();

    if env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        let native_wayland = is_native_wayland(
            env::var_os("WAYLAND_DISPLAY").as_deref(),
            env::var_os("GDK_BACKEND").as_deref(),
        );
        match dmabuf_plan(
            appimage,
            nvidia_driver_present(),
            native_wayland,
            env::var_os(NV_DISABLE_EXPLICIT_SYNC).as_deref(),
        ) {
            DmabufPlan::Keep => {}
            DmabufPlan::DisableExplicitSync => env::set_var(NV_DISABLE_EXPLICIT_SYNC, "1"),
            DmabufPlan::DisableDmabuf => env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1"),
        }
    }

    // The bundled-libwayland conflict only exists inside an AppImage on a
    // Wayland session. Skip when the user brought their own LD_PRELOAD.
    if appimage
        && env::var_os("WAYLAND_DISPLAY").is_some()
        && env::var_os(PRELOAD_GUARD).is_none()
        && env::var_os("LD_PRELOAD").is_none_or(|v| v.is_empty())
    {
        if let Some(lib) = first_matching_lib(WAYLAND_CLIENT_CANDIDATES) {
            reexec_with_preload(&lib);
        }
    }
}

fn nvidia_driver_present() -> bool {
    Path::new("/proc/driver/nvidia").exists() || Path::new("/sys/module/nvidia").exists()
}

#[derive(Debug, PartialEq)]
enum DmabufPlan {
    Keep,
    DisableExplicitSync,
    DisableDmabuf,
}

/// Decides how to keep WebKit's DMA-BUF renderer from failing. Only called
/// when the user hasn't set `WEBKIT_DISABLE_DMABUF_RENDERER` themselves.
fn dmabuf_plan(
    appimage: bool,
    nvidia: bool,
    native_wayland: bool,
    nv_disable_explicit_sync: Option<&OsStr>,
) -> DmabufPlan {
    if appimage || (nvidia && !native_wayland) {
        // X11 + NVIDIA shows a blank page ("Failed to create GBM buffer"), and the
        // AppImage's GTK hook forces GDK_BACKEND=x11.
        return DmabufPlan::DisableDmabuf;
    }
    if !nvidia {
        return DmabufPlan::Keep;
    }
    match nv_disable_explicit_sync {
        None => DmabufPlan::DisableExplicitSync,
        // The driver treats "0" and "" as explicit sync on, which still hits the error.
        Some(v) if v.is_empty() || v == "0" => DmabufPlan::DisableDmabuf,
        Some(_) => DmabufPlan::Keep,
    }
}

/// Whether GTK will pick its Wayland backend. `GDK_BACKEND` may be a
/// comma-separated preference list; GTK tries the first entry first.
fn is_native_wayland(wayland_display: Option<&OsStr>, gdk_backend: Option<&OsStr>) -> bool {
    if wayland_display.is_none_or(|v| v.is_empty()) {
        return false;
    }
    let Some(backend) = gdk_backend else {
        return true;
    };
    matches!(
        backend
            .to_str()
            .map(|b| b.split(',').next().unwrap_or("").trim()),
        Some("" | "*" | "wayland")
    )
}

/// First candidate that exists and is an ELF shared object matching this
/// process's class and machine — preloading a 32-bit or foreign-arch library
/// would abort the dynamic linker outright.
fn first_matching_lib(candidates: &[&str]) -> Option<PathBuf> {
    candidates
        .iter()
        .map(Path::new)
        .find(|p| elf_matches_host(p))
        .map(Path::to_path_buf)
}

#[cfg(target_arch = "x86_64")]
const EXPECTED_E_MACHINE: u16 = 62; // EM_X86_64
#[cfg(target_arch = "aarch64")]
const EXPECTED_E_MACHINE: u16 = 183; // EM_AARCH64
#[cfg(not(any(target_arch = "x86_64", target_arch = "aarch64")))]
const EXPECTED_E_MACHINE: u16 = 0; // unknown host arch: never match, skip the fix

fn elf_matches_host(path: &Path) -> bool {
    let mut hdr = [0u8; 20];
    let Ok(mut f) = std::fs::File::open(path) else {
        return false;
    };
    if f.read_exact(&mut hdr).is_err() || &hdr[..4] != b"\x7fELF" {
        return false;
    }
    // e_ident[EI_CLASS]: 1 = 32-bit, 2 = 64-bit.
    let class_ok = hdr[4]
        == if cfg!(target_pointer_width = "64") {
            2
        } else {
            1
        };
    // e_machine (u16 at offset 18; both supported arches are little-endian).
    let machine_ok = u16::from_le_bytes([hdr[18], hdr[19]]) == EXPECTED_E_MACHINE;
    class_ok && machine_ok
}

/// Replace this process with an identical one, plus the preload. Only
/// returns on failure, in which case startup continues un-preloaded (worst
/// case is the white window the user already had).
fn reexec_with_preload(lib: &Path) {
    use std::os::unix::process::CommandExt;
    let _ = std::process::Command::new("/proc/self/exe")
        .args(env::args_os().skip(1))
        .env("LD_PRELOAD", lib)
        .env(PRELOAD_GUARD, "1")
        .exec();
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn write_lib(dir: &Path, name: &str, bytes: &[u8]) -> PathBuf {
        let p = dir.join(name);
        std::fs::File::create(&p).unwrap().write_all(bytes).unwrap();
        p
    }

    /// Minimal ELF header prefix: magic, class, then padding up to e_machine.
    fn elf_prefix(class: u8, machine: u16) -> Vec<u8> {
        let mut v = vec![0u8; 20];
        v[..4].copy_from_slice(b"\x7fELF");
        v[4] = class;
        v[18..20].copy_from_slice(&machine.to_le_bytes());
        v
    }

    #[test]
    fn rejects_non_elf_and_missing_files() {
        let dir = tempfile::tempdir().unwrap();
        let junk = write_lib(dir.path(), "junk.so", b"not an elf at all!!!");
        assert!(!elf_matches_host(&junk));
        assert!(!elf_matches_host(&dir.path().join("nope.so")));
    }

    #[test]
    fn rejects_wrong_class_and_machine() {
        let dir = tempfile::tempdir().unwrap();
        let wrong_class = write_lib(dir.path(), "c.so", &elf_prefix(1, EXPECTED_E_MACHINE));
        let wrong_machine = write_lib(dir.path(), "m.so", &elf_prefix(2, 0xBEEF));
        assert!(!elf_matches_host(&wrong_class));
        assert!(!elf_matches_host(&wrong_machine));
    }

    #[test]
    fn picks_first_matching_candidate() {
        let dir = tempfile::tempdir().unwrap();
        let bad = write_lib(dir.path(), "bad.so", b"junk");
        let good = write_lib(dir.path(), "good.so", &elf_prefix(2, EXPECTED_E_MACHINE));
        let cands = [bad.to_str().unwrap(), good.to_str().unwrap()];
        // Only meaningful on 64-bit test hosts, which is everything we CI on.
        if cfg!(target_pointer_width = "64") && EXPECTED_E_MACHINE != 0 {
            assert_eq!(first_matching_lib(&cands), Some(good));
        }
    }

    fn os(s: &str) -> Option<&OsStr> {
        Some(OsStr::new(s))
    }

    #[test]
    fn nvidia_on_native_wayland_keeps_dmabuf_without_explicit_sync() {
        assert_eq!(
            dmabuf_plan(false, true, true, None),
            DmabufPlan::DisableExplicitSync
        );
        assert_eq!(dmabuf_plan(false, true, true, os("1")), DmabufPlan::Keep);
    }

    #[test]
    fn nvidia_with_explicit_sync_forced_on_disables_dmabuf() {
        assert_eq!(
            dmabuf_plan(false, true, true, os("0")),
            DmabufPlan::DisableDmabuf
        );
        assert_eq!(
            dmabuf_plan(false, true, true, os("")),
            DmabufPlan::DisableDmabuf
        );
    }

    #[test]
    fn x11_nvidia_and_appimage_disable_dmabuf() {
        assert_eq!(
            dmabuf_plan(false, true, false, None),
            DmabufPlan::DisableDmabuf
        );
        assert_eq!(
            dmabuf_plan(false, true, false, os("1")),
            DmabufPlan::DisableDmabuf
        );
        assert_eq!(
            dmabuf_plan(true, false, true, None),
            DmabufPlan::DisableDmabuf
        );
        assert_eq!(
            dmabuf_plan(true, true, true, None),
            DmabufPlan::DisableDmabuf
        );
    }

    #[test]
    fn non_nvidia_keeps_dmabuf() {
        assert_eq!(dmabuf_plan(false, false, true, None), DmabufPlan::Keep);
        assert_eq!(dmabuf_plan(false, false, false, None), DmabufPlan::Keep);
    }

    #[test]
    fn detects_native_wayland_from_gdk_backend() {
        let wl = os("wayland-0");
        assert!(is_native_wayland(wl, None));
        assert!(is_native_wayland(wl, os("")));
        assert!(is_native_wayland(wl, os("wayland,x11")));
        assert!(is_native_wayland(wl, os("*")));
        assert!(!is_native_wayland(wl, os("x11")));
        assert!(!is_native_wayland(wl, os("x11,wayland")));
        assert!(!is_native_wayland(None, None));
        assert!(!is_native_wayland(os(""), os("wayland")));
    }
}
