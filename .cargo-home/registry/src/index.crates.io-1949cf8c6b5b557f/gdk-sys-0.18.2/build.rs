#[cfg(not(docsrs))]
use std::io;
#[cfg(not(docsrs))]
use std::io::prelude::*;
#[cfg(not(docsrs))]
use std::process;

#[cfg(docsrs)]
fn main() {} // prevent linking libraries to avoid documentation failure

#[cfg(not(docsrs))]
fn main() {
    if let Err(s) = system_deps::Config::new().probe() {
        let _ = writeln!(io::stderr(), "{s}");
        process::exit(1);
    }

    // It's safe to assume we can call this because we found the library OK
    // in find()
    check_features();
}

#[cfg(not(docsrs))]
fn check_features() {
    const PKG_CONFIG_PACKAGE: &str = "gdk-3.0";

    // The pkg-config file defines a `targets` variable listing the
    // various backends that gdk was compiled for.
    // We extract that and create gdk_backend="x11" and the like
    // as configuration variables.
    // In addition we publish this as a variable which cargo will
    // provide to immediate dependents of this crate as an environment
    // variable for their `build.rs` runs called DEP_GDK_BACKENDS
    // For reference, the backend set at time of writing consists of:
    // x11 win32 quartz broadway wayland
    if let Ok(targets) = pkg_config::get_variable(PKG_CONFIG_PACKAGE, "targets") {
        println!("cargo:backends={targets}");
        for target in targets.split_whitespace() {
            println!("cargo:rustc-cfg=gdk_backend=\"{target}\"");
        }
    }
}
