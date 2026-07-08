use super::api::WrapperApi;

/**
Allows creation of complex, optional APIs.

Real life dynamic link libraries often come in multiple versions. Sometimes additional functions
are added for the specific operating system, sometimes the library gets extended and new versions
export more symbols. Often the API can have multiple versions. This trait helps creating
library APIs with multiple optional parts.

`WrapperMultiApi` is intended to be used together with the derive macro. You should create a new
structure where all fields implement the `WrapperApi` trait (this includes `Option<T>` where
`T` implements `WrapperApi`). The derive macro will generate required implementation.

**Note**: `WrapperMultiApi` should only be used together with `Container` structure, never to create
a standalone object. API and library handle need to be kept together to prevent dangling symbols.

```no_run
use dlopen2::wrapper::{Container, WrapperApi, WrapperMultiApi};

//Define 3 APIs:

#[derive(WrapperApi)]
struct Obligatory{
    some_fun: unsafe extern "C" fn()
}

#[derive(WrapperApi)]
struct Optional1<'a>{
    static_val: &'a i32
}

#[derive(WrapperApi)]
struct Optional2{
   another_fun: unsafe extern "C" fn()
}

//Now define a multi wrapper that wraps sub APIs into one bigger API.
//This example assumes that the first API is obligatory and the other two are optional.

#[derive(WrapperMultiApi)]
struct Api<'a>{
    pub obligatory: Obligatory,
    pub optional1: Option<Optional1<'a>>,
    pub optional2: Option<Optional2>
}

fn main(){
    let mut container: Container<Api> = unsafe {
        Container::load("libexample.so")
    }.expect("Could not open library or load symbols");

    //use obligatory API:
    unsafe{container.obligatory.some_fun()};

    //use first optional API:
    if let Some(ref opt) = container.optional1{
        let _val = *opt.static_val();
    }

    //use second optional API:
    if let Some(ref opt) = container.optional2{
        unsafe {opt.another_fun()};
    }
}
```
*/
pub trait WrapperMultiApi: WrapperApi {}
