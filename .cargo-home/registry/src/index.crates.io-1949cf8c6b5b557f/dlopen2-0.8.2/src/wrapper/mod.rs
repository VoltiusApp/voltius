/*!
High-level and safe API for opening and getting symbols from dynamic link libraries.
It is based on wrapping private symbols with public functions to prevent direct access
and supports automatic loading of symbols into structures.

This API solves the problem with dangling symbols by wrapping raw symbols with public functions.
User of API does not have direct access to raw symbols and therefore symbols cannot be copied.
Symbols and library handle are kept in one `Container` structure and therefore both the the library
and symbols get released at the same time.

#Example

```no_run
use dlopen2::wrapper::{Container, WrapperApi};

#[derive(WrapperApi)]
struct Example<'a> {
    do_something: extern "C" fn(),
    add_one: unsafe extern "C" fn (arg: i32) -> i32,
    global_count: &'a mut u32,
}

fn main () {
let mut container: Container<Example> = unsafe { Container::load("libexample.dylib")}.unwrap();
container.do_something();
let _result = unsafe { container.add_one(5) };
*container.global_count_mut() += 1;

//symbols are released together with library handle
//this prevents dangling symbols
drop(container);
}
```

Unfortunately in Rust it is not possible to create an API for dynamic link libraries that would
be 100% safe. This API aims to be 99% safe by providing zero cost functional wrappers around
raw symbols. However it is possible to make a mistake if you create API as a standalone object
(not in container):

#Example of a mistake - dangling symbol

```no_run
use dlopen2::wrapper::{Container, WrapperApi};
use dlopen2::raw::Library;

#[derive(WrapperApi)]
struct Example<'a> {
    do_something: extern "C" fn(),
    add_one: unsafe extern "C" fn (arg: i32) -> i32,
    global_count: &'a mut u32,
}

fn main () {
let lib = Library::open("libexample.dylib").unwrap();
let mut api = unsafe{Example::load(&lib)};
drop(lib);

//api has now dangling symbols

}
```

To prevent this mistake don't use structures implementing `WrapperApi` directly, but rather use
`Container` as in the first example.

**Note:** This API has a broad support for optional symbols (this solves the issue with multiple
versions of one dynamic link library that have different sets of symbols). Please refer to the
documentation of
[`OptionalContainer`](./struct.OptionalContainer.html)
and
[`WrapperMultiApi`](./trait.WrapperMultiApi.html).
*/

mod api;
mod container;
mod multi_api;
mod option;
mod optional;
pub use self::api::WrapperApi;
pub use self::container::Container;
pub use self::multi_api::WrapperMultiApi;
pub use self::optional::OptionalContainer;

#[cfg(feature = "derive")]
pub use dlopen2_derive::{WrapperApi, WrapperMultiApi};
