/*!

# Sample Credential Store

This sample store is provided for two purposes:

- It provides a cross-platform way to test your client code during development.
  (To help with this, all of its internal structures are public.)
- It provides a template for developers who want to write credential stores.
  (The tests as well as the source structure can be adapted.)

This store is explicitly *not* for use in production apps! It's neither robust
nor secure.

# Persistence

When creating an instance of this store, you specify whether you want the contents
of the store to persist between runs (by default, they don't).  There are two
ways to specify this:

- You can specify the `persist` modifier as `true`. In this case, the store will
  be persisted in a file called `keyring-sample-store.ron` in the native platform
  shared temporary directory.

- You can specify the `backing-file` modifier with a path to a file. In this case,
  the store will be persisted in the specified file. (If you specify the `backing-file`
  modifier, the `persist` modifier is ignored.)

_Buyer beware!_ A store's backing file is _not_ kept up to date as credentials are created,
deleted, or modified in the store!
The in-memory credentials are only saved to the backing file when
explicitly requested or when a store is destroyed (that is, the last reference
to it is released).
The credential state saved in a backing file (if it exists from a prior run)
is only loaded when a store using that file is first created.

# Ambiguity

This store supports ambiguity, that is, the ability to create
multiple credentials associated with the same service name
and username. If you specify the `force-create` modifier when
creating an entry, a new credential with an empty password
will be created immediately for the specified service name and username.

* If there was _not_ an existing credential for your service name
  and username, then the newly created credential will be the
  only one, so the returned entry will not be ambiguous.
* If there _was_ an existing credential for your service name and username,
  then the returned entry will be ambiguous.

In all cases, the use of the `force-create` modifier will cause
the created credential to have two additional attributes:

* *creation-date*, an HTTP-style date showing when the
  credential was created. This cannot be updated, nor
  can it be added to credentials that don't have it.
* *comment*, the string value of the `target` modifier.
  This can be updated, and it can be added to credentials
  that don't have it.

# Attributes

Credentials in this store, in addition to the attributes
described in the section on Ambiguity above, have
a single read-only attribute `uuid` which is the
unique ID of the credential in the store.

# Search

This store implements credential search. Specs can specify
desired regular expressions for the `service` and `user` a
credential is attached to, and for the `comment` and `uuid` attributes
of the credential itself. (All other key/value pairs in the spec
are ignored.) Credentials are returned only if _all_ the
specified regular expressions match against its values.

Note: Search is implemented by iterating over every credential
in the store. This is an in-memory store, so it happens
pretty quickly.

 */

pub mod credential;
pub use credential::CredKey;

pub mod store;
pub use store::Store;

#[cfg(test)]
mod test;
