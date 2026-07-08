fn main() {
    check_features();
}

fn check_features() {
    // The pkg-config file defines a `targets` variable listing the
    // various backends that gdk (yes, gdk) was compiled for.
    // We extract that and create gdk_backend="x11" and the like
    // as configuration variables.
    // For reference, the backend set at time of writing consists of:
    // x11 win32 quartz broadway wayland
    if let Ok(targets) = pkg_config::get_variable("gtk+-3.0", "targets") {
        for target in targets.split_whitespace() {
            println!("cargo:rustc-cfg=gdk_backend=\"{target}\"");
        }
    }
}
