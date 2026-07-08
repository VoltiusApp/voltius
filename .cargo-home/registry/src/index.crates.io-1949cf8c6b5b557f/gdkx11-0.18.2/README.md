# Rust GDKX11 bindings

**This project is UNMAINTAINED. Please take a look at [gtk4-rs](https://github.com/gtk-rs/gtk4-rs) instead!**

Project site is [here](https://gtk-rs.org/).

__Rust__ bindings and wrappers for [GDKX11](https://developer.gnome.org/gdk3/stable/gdk3-X-Window-System-Interaction.html),
part of [gtk3-rs](https://github.com/gtk-rs/gtk3-rs).

GDKX11 __3.22__ is the lowest supported version for the underlying library.

## Minimum supported Rust version

Currently, the minimum supported Rust version is `1.70.0`.

## Documentation

 * [Rust API - Stable](https://gtk-rs.org/gtk3-rs/stable/latest/docs/gdkx11/)
 * [Rust API - Development](https://gtk-rs.org/gtk3-rs/git/docs/gdkx11)
 * [GTK Installation instructions](https://www.gtk.org/docs/installations/)

## Using

We recommend using [crates from crates.io](https://crates.io/keywords/gtk-rs),
as [demonstrated here](https://gtk-rs.org/#using).

If you want to track the bleeding edge, use the git dependency instead:

```toml
[dependencies]
gdkx11 = { git = "https://github.com/gtk-rs/gtk3-rs.git", package = "gdkx11" }
```

Avoid mixing versioned and git crates like this:

```toml
# This will not compile
[dependencies]
gdkx11 = "0.13"
gdkx11 = { git = "https://github.com/gtk-rs/gtk3-rs.git", package = "gdkx11" }
```

### See Also

 * [glib](https://crates.io/crates/glib)
 * [gio](https://crates.io/crates/gio)
 * [gdk](https://crates.io/crates/gdk)

## License

__gdkx11__ is available under the MIT License, please refer to it.
