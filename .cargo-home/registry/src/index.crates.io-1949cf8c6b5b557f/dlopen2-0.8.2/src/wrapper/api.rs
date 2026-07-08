use super::super::err::Error;
use super::super::raw::Library;

/**
Trait for defining library API.

This trait is intended to be used with `#[derive(WrapperApi)]` macro defined in the
`dlopen2_derive` crate. It forces several restrictions on types that implement it:

* Only structures can implement this trait.
* All fields need to be private.
* Only functions, references and pointers are allowed.
* You can't define a type using `type Fun =fn();` and use it in the structure. This is a limitation
  of the Rust reflection mechanism. Only raw functions, references and pointers are allowed.
* All arguments of functions need to be named.


The `derive` macro not only generates implementation of `load()` function, but it also generates
safe wrappers around the loaded symbols. These wrappers are named exactly like the field that
they wrap. Wrappers of functions have the same arguments like original functions and wrappers of
references are just simple accessors in the form of `<field_name>(&self) -> &FieldType` or
`<field_name>_mut(&mut self) -> &mut FieldType`.
Wrappers are not generated only for:

* Pointers - there is no safe way of preventing dangling symbols if a user has a direct access to
  pointers. The recommended approach here is to either use references instead of pointers or
  to manually create safe wrappers. For example C `const char *` can be manually converted into
  `& std::ffi::CStr`.
* Variadic functions. Rust doesn't have any mechanism that allows creating safe wrappers around
  them. You need to handle them manually.

#Example

```no_run
use dlopen2::wrapper::{WrapperApi, Container};
use std::os::raw::{c_char};
use std::ffi::CStr;

#[derive(WrapperApi)]
struct Example<'a> {
    #[dlopen2_name="function"]
    do_something: extern "C" fn(),
    add_one: unsafe extern "C" fn (arg: i32) -> i32,
    global_count: &'a mut u32,
    c_string: * const c_char,
    #[dlopen2_allow_null]
    maybe_null_ptr: * const (),
}

//wrapper for c_string won't be generated, implement it here
impl<'a> Example<'a> {
    pub fn c_string(&self) -> &CStr {
        unsafe {CStr::from_ptr(self.c_string)}
    }
}

fn main () {
    let mut cont: Container<Example> = unsafe { Container::load("libexample.dylib")}.unwrap();
    cont.do_something();
    let _result = unsafe { cont.add_one(5) };
    *cont.global_count_mut() += 1;
    println!("C string: {}", cont.c_string().to_str().unwrap())
}
```

**Note**: `WrapperApi` should only be used together with `Container` structure, never to create
a standalone object. API and library handle need to be kept together to prevent dangling symbols.

**Note:** By default obtained symbol name is the field name. You can change this by
assigning the "dlopen2_name" attribute to the given field.

**Note:** By default `Error::NullSymbol` is returned if the loaded symbol name has a null value.
While null is a valid value of a exported symbol, it is usually not expected by users of libraries.
If in your scenario null is an acceptable value, you should assign
"dlopen2_allow_null" attribute to the given field. Of course this makes sense only if the field
is of pointer type.
*/
pub trait WrapperApi
where
    Self: Sized,
{
    /// Load symbols from provided library.
    unsafe fn load(lib: &Library) -> Result<Self, Error>;
}
