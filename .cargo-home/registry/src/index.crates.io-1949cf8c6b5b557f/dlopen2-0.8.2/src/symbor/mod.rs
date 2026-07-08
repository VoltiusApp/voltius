/*!
High-level and safe API for opening and getting symbols from dynamic libraries.
It is based on symbol borrowing mechanism and supports automatic loading of symbols into structures.

This API uses Rust borrowing mechanism to prevent problems with dangling symbols
that take place when the library gets closed but the symbols still exist and are used.

#Example of a dangling symbol prevention
```no_run
use dlopen2::symbor::Library;
fn main(){
    let lib = Library::open("libexample.dylib").unwrap();
    let fun = unsafe{lib.symbol::<unsafe extern "C" fn(f64)->f64>("some_symbol_name")}.unwrap();
    println!("fun(1.0) = {}", unsafe{fun(1.0)});

    //this would not compile because fun is a symbol borrowed from lib
    //drop(lib);
}
```
**Note:** All kind of objects from the `symbor` module implement the Deref or DerefMut trait.
This means that you can use them as if you would use primitive types that they wrap.

It also allows automatic loading of symbols into a structure.
This is especially handy if you have a huge API with multiple symbols:

# Example of automatic symbol loading

```no_run
use dlopen2::symbor::{Library, Symbol, Ref, PtrOrNull, SymBorApi};

 #[derive(SymBorApi)]
 struct ExampleApi<'a> {
    pub fun: Symbol<'a, unsafe extern "C" fn(i32) -> i32>,
    pub glob_i32: Ref<'a, i32>,
    pub maybe_c_str: PtrOrNull<'a, u8>,
    pub opt_fun: Option<Symbol<'a, fn()>>
 }

fn main(){
    let lib = Library::open("example.dll").expect("Could not open library");
    let api = unsafe{ExampleApi::load(&lib)}.expect("Could not load symbols");
    println!("fun(4)={}", unsafe{(api.fun)(4)});
    println!("glob_i32={}", *api.glob_i32);
    println!("The pointer is null={}", api.maybe_c_str.is_null());
    match api.opt_fun {
        Some(fun) => fun(),
        None => println!("Optional function not found in the library")
    }

    //this would not compile:
    //drop(lib);
}
```

**Note:** You can obtain optional symbols (`Option<Symbol<T>>`).
This is very useful when you are dealing with
    different versions of libraries and the newer versions support more functions.
    If it is not possible to obtain the given symbol, the option is set to `None',
    otherwise it contains the obtained symbol.

Unfortunately in Rust it is not possible to create an API for dynamic link libraries that would
be 100% safe. This API aims to be 99% safe by providing zero cost wrappers around raw symbols.
However it is possible to make a mistake if you dereference safe wrappers into raw symbols.

#Example of a mistake - dangling symbol

```no_run
use dlopen2::symbor::Library;
fn main(){
    let raw_fun = {
        let lib = Library::open("libexample.dylib").unwrap();
        let safe_fun = unsafe{
            lib.symbol::<unsafe extern "C" fn(f64)->f64>("some_symbol_name")
        }.unwrap();
        *safe_fun
    };

    //raw_fun is now a dangling symbol
}
```

Original idea for this solution comes from Simonas Kazlauskas and his crate
[libloading](https://github.com/nagisa/rust_libloading).
Many improvements were added to solve several issues.

*/

mod api;
mod container;
mod from_raw;
mod library;
mod option;
mod ptr_or_null;
mod ptr_or_null_mut;
mod reference;
mod reference_mut;
mod symbol;

pub use self::api::SymBorApi;
pub use self::container::Container;
pub use self::from_raw::FromRawResult;
pub use self::library::Library;
pub use self::ptr_or_null::PtrOrNull;
pub use self::ptr_or_null_mut::PtrOrNullMut;
pub use self::reference::Ref;
pub use self::reference_mut::RefMut;
pub use self::symbol::Symbol;

#[cfg(feature = "derive")]
pub use dlopen2_derive::SymBorApi;
