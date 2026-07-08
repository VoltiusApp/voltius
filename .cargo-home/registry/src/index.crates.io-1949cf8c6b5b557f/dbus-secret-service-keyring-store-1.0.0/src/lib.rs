/*!

# dbus-secret-service credential store for keyring

This module implements a credential store for the
[keyring](https://github.com/open-source-cooperative/keyring-rs/wiki/Keyring)
that uses the secret service as its back end via the
[dbus-secret-service crate](https://crates.io/crates/dbus-secret-service).

## Attributes

Credentials in the Secret Service are called _items_. Items are organized into
groups called _collections_. Items are found by searching on their attributes
(key-value pairs). Each item has a unique ID called a _path_ but the path is not
visible to clients and cannot be used to find an item.

This store, by default, creates items in the _default_ collection (aka the
user's login collection). Specifying a `target` modifier when creating an entry
will create a new collection named by the target and the item for the entry will
be created in that collection.

This implementation controls the following attributes on items:

- `service` (required & taken from the `service` parameter to the entry creation call)
- `username` (required & taken from the `user` parameter to the entry creation call)
- `target` (optional & taken from the `target` modifier in the entry creation call)

In addition, when creating a new item, this implementation assigns
the created item a `label` property (for use in Secret Service UI). If the
modifier `label` is set in the entry creation call, that value is used
as the label. Otherwise, the label is set to the Rust-formatted string:
`keyring:{user}@{service}`.

Client code is allowed to retrieve and to set all attributes _except_ the
three that are controlled by this implementation. The label is accessible
and settable via credential-level calls, but not via entry-level calls.
The example program in this crate shows how to get at the credential object
in an entry and use its API.

## Ambiguity

Existing items are always searched for at the service level, which means all
collections are searched. The search attributes used are `service` (set from the
entry service) and `username` (set from the entry user). In addition, if a
`target` modifier was specified in the creation call of an entry, the `target`
attribute is also used in the search for that entry: this allows items with the
same service and user in different collections to be distinguished.

Note that existing items created or updated by 3rd party applications may have
additional attributes; such items will be found when searching for items with
the same service and user.

## Features

This crate has no features of its own: all of its features are simply passed on
to the [dbus-secret-service crate](https://crates.io/crates/dbus-secret-service)
that it uses to communicate with Secret Service.
(See the [docs for that crate](https://docs.rs/docs/dbus-secret-service) for details.)
You must enable either the `crypto-rust` or the `crypto-openssl` feature because this
crate always encrypts communication with the Secret Service. You can additionally
enable the `vendored` feature if you want the required C libraries
(dbus and, if specified, openssl) statically linked with your application.

## Headless usage

If you must use the secret-service on a headless linux box, be aware that there
are known issues with getting dbus and secret-service and the gnome keyring to
work properly in headless environments. For a quick workaround, look at how this
project's
[CI workflow](https://github.com/hwchen/keyring-rs/blob/master/.github/workflows/ci.yaml)
starts the Gnome keyring unlocked with a known password; a similar solution is
also documented in the
[Python Keyring docs](https://pypi.org/project/keyring/)
(search for "Using Keyring on headless Linux systems"). The following `bash`
function may be helpful:

```shell
function unlock-keyring ()
{
    read -rsp "Password: " pass
    echo -n "$pass" | gnome-keyring-daemon --unlock
    unset pass
}
```

For an excellent treatment of all the headless dbus issues, see
[this answer on ServerFault](https://serverfault.com/a/906224/79617).

## Usage on Windows Subsystem for Linux

As noted in
[this issue on GitHub](https://github.com/open-source-cooperative/keyring-rs/issues/133),
there is no "default" collection defined under WSL.  So this crate will not work
on WSL unless you specify a non-`default` target modifier on every specifier.

## Usage with KDE Wallet

On many KDE-based desktop systems, the default Secret Service implementation
is provided by the KDE Wallet (and its included secret-service-api wrapper).
Since the KDE Wallet itself is limited to reading and writing UTF-8 data,
you cannot use this module to store arbitrary binary secrets unless you
first encode them as UTF-8 strings (e.g., via base64 encoding). Once you
encode your secrets in UTF-8, you can read and write them using as either
passwords or secrets in this interface.

 */

pub mod cred;
pub mod errors;
mod service;
pub mod store;
pub use store::Store;
#[cfg(test)]
mod tests;
