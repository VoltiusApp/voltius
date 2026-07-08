/*!
Low-level API for opening and getting raw symbols from dynamic link libraries.

As a low-level API it returns raw pointers, references and functions from loaded libraries.
This means that this API does not provide any protection against problems with dangling symbols.
You may consider using other APIs to achieve better safety.
However this API is the most flexible one and you may find is useful when creating your custom
approach to loading dynamic link libraries.

# Example
```no_run
use dlopen2::raw::Library;
fn main(){
    let lib = Library::open("libexample.so").unwrap();
    let fun_add_one: unsafe extern "C" fn(i32)->i32 = unsafe{lib.symbol("add_one")}.unwrap();
    println!("1+1= {}", unsafe{fun_add_one(1)});

    drop(lib);
    //warning! fun_add_one is now a dangling symbol and use of it may crash your application.
}
```
*/

//!

mod common;
#[cfg(test)]
mod tests;
#[cfg(unix)]
mod unix;
#[cfg(windows)]
mod windows;

pub use self::common::{AddressInfo, AddressInfoObtainer, Handle, Library, OverlappingSymbol};
