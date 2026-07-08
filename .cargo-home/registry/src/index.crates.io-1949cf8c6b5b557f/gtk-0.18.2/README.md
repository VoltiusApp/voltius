# Rust GTK 3 bindings

**This project is UNMAINTAINED. Please take a look at [gtk4-rs](https://github.com/gtk-rs/gtk4-rs) instead!**

[Project site](http://gtk-rs.org/)

__Rust__ bindings and wrappers for __GTK 3__, part of [gtk3-rs](https://github.com/gtk-rs/gtk3-rs),
a multi-platform GUI toolkit. It is a part of [gtk-rs](http://gtk-rs.org/).

GTK __3.22.30__ is the lowest supported version for the underlying library.

## Minimum supported Rust version

Currently, the minimum supported Rust version is `1.70.0`.

## Building

__gtk__ expects __GTK__, __GLib__ and __Cairo__ development files to be installed on your system.
See the [GTK installation page](https://www.gtk.org/docs/installations/).

## Using

We recommend using [crates from crates.io](https://crates.io/keywords/gtk-rs),
as [demonstrated here](http://gtk-rs.org/#using).

If you want to track the bleeding edge, use the git dependency instead:

```toml
[dependencies]
gtk = { git = "https://github.com/gtk-rs/gtk3-rs.git" }
```

Avoid mixing versioned and git crates like this:

```toml
# This will not compile
[dependencies]
gtk = "0.13"
gtk = { git = "https://github.com/gtk-rs/gtk3-rs.git" }
```

# "Hello, World!" example program
//!
GTK needs to be initialized before use by calling [`fn@init`]. Creating an
[`struct@Application`] will call [`fn@init`] for you.

```rust,no_run
use gtk::prelude::*;
use gtk::{Application, ApplicationWindow};

fn main() {
    let app = Application::builder()
        .application_id("org.example.HelloWorld")
        .build();

    app.connect_activate(|app| {
        // We create the main window.
        let win = ApplicationWindow::builder()
            .application(app)
            .default_width(320)
            .default_height(200)
            .title("Hello, World!")
            .build();

        // Don't forget to make all widgets visible.
        win.show_all();
    });

    app.run();
}
```

# The main loop

In a typical GTK application you set up the UI, assign signal handlers
and run the main event loop.

```rust,no_run

use gtk::prelude::*;
use gtk::{Application, ApplicationWindow, Button};

fn main() {
    let application = Application::builder()
        .application_id("com.example.FirstGtkApp")
        .build();

    application.connect_activate(|app| {
        let window = ApplicationWindow::builder()
            .application(app)
            .title("First GTK Program")
            .default_width(350)
            .default_height(70)
            .build();

        let button = Button::with_label("Click me!");
        button.connect_clicked(|_| {
            eprintln!("Clicked!");
        });
        window.add(&button);

        window.show_all();
    });

    application.run();
}
```

# Threads

GTK is not thread-safe. Accordingly, none of this crate's structs implement
[`Send`] or [`Sync`].

The thread where [`fn@init`] was called is considered the main thread. OS X has
its own notion of the main thread and [`fn@init`] must be called on that thread.
After successful initialization, calling any [`gtk`](mod@crate) or [`mod@gdk`] functions
(including [`fn@init`]) from other threads will `panic`.

Any thread can schedule a closure to be run by the main loop on the main
thread via [`fn@glib::idle_add`] or [`fn@glib::timeout_add`]. While
working with GTK you might need the [`fn@glib::idle_add_local`]
or [`fn@glib::timeout_add_local`] version without the
[`Send`] bound. Those may only be called from the main thread.

# Panics

The [`gtk`](mod@crate) and [`mod@gdk`] crates have some run-time safety and contract checks.

- Any constructor or free function will panic if called before [`fn@init`] or on
a non-main thread.

- Any [`&str`] or [`&Path`](std::path::Path) parameter with an interior null (`\0`) character will
cause a panic.

- Some functions will panic if supplied out-of-range integer parameters. All
such cases will be documented individually but they are not yet.

- A panic in a closure that handles signals or in any other closure passed
to a [`gtk`](mod@crate) function will abort the process.

# Features

## Library versions

By default this crate provides only GTK 3.22.30 APIs. You can access additional
functionality by selecting one of the `v3_24`, etc. features.

`Cargo.toml` example:

```toml
[dependencies.gtk]
version = "0.x.y"
features = ["v3_24"]
```

Take care when choosing the version to target: some of your users might
not have easy access to the latest ones. The higher the version, the fewer
users will have it installed.

## Documentation

Most of this documentation is generated from the C API.

Until all parts of the documentation have been reviewed there will be incongruities
with the actual Rust API.

 * [Rust API - Stable](https://gtk-rs.org/gtk3-rs/stable/latest/docs/gtk/)
 * [Rust API - Development](https://gtk-rs.org/gtk3-rs/git/docs/gtk)
 * [C API](https://developer.gnome.org/gtk/stable/)
 * [GTK Installation instructions](https://www.gtk.org/docs/installations/)

Generate the docs:

```shell
> RUSTFLAGS="--cfg docsrs" cargo doc
```

(if the installed GTK+ version is lower than 3.16, adjust the feature name accordingly).

## Contribute

Contributor you're welcome!

See the general [bindings documentation](https://gtk-rs.org/gtk-rs-core/stable/latest/docs/glib/).

Most of the bindings ([`src/auto`](src/auto)) are generated by [gir](https://github.com/gtk-rs/gir) using [this configuration file](Gir.toml). After editing `Gir.toml` the sources can be regenerated with

```shell
> make gir
```

When opening a PR please put the changes to the `src/auto` directory in a separate commit.

You may also wish to run `cargo clippy -- -D warnings` and check that you're clean because
otherwise you may be surprised when CI fails.

## See Also

 * [atk](https://crates.io/crates/atk)
 * [cairo](https://crates.io/crates/cairo-rs)
 * [gdk](https://crates.io/crates/gdk)
 * [gdk-pixbuf](https://crates.io/crates/gdk-pixbuf)
 * [gio](https://crates.io/crates/gio)
 * [glib](https://crates.io/crates/glib)
 * [pango](https://crates.io/crates/pango)

But also:

 * [gtk-rs project overview](https://gtk-rs.org)
 * [General `GLib` family types and object system overview](mod@glib)
 * [GTK documentation](https://www.gtk.org/docs/)

## License

__gtk__ is available under the MIT License, please refer to it.
