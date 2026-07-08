use super::super::err::Error;
use super::library::Library;
/**
Trait for automatic loading of symbols from library.

This trait is intended to be used together with the `derive` macro.
To use it you need to define a structure, create several fields that
implement the `FromRawResult` trait and then simply use the automatically
generated `load(&Library)` function to load all symbols from previously opened library.

```no_run
use dlopen2::symbor::{Library, Symbol, SymBorApi, PtrOrNull, RefMut, PtrOrNullMut};
use std::os::raw::{c_double, c_char};

#[derive(SymBorApi)]
struct Example<'a> {
    pub simple_fun: Symbol<'a, unsafe extern "C" fn()>,
    pub complex_fun: Symbol<'a, unsafe extern "C" fn(c_double)->c_double>,
    pub optional_fun: Option<Symbol<'a, unsafe extern "C" fn()>>,
    pub nullable_ptr: PtrOrNullMut<'a, c_char>,
    pub mut_ref_i32: Symbol<'a, &'a mut i32>,
    #[dlopen2_name="mut_ref_i32"]
    pub the_same_mut_ref_i32: RefMut<'a, i32>,
    pub not_nullable_ptr: Symbol<'a, * mut c_double>
}

fn main(){
    let lib = Library::open("example.dll").expect("Could not open library");
    let mut api = unsafe{Example::load(&lib)}.expect("Could not load symbols");
    unsafe{(api.simple_fun)()};
    let _ = unsafe{(api.complex_fun)(1.0)};
    match api.optional_fun {
        Some(fun) => unsafe {fun()},
        None => println!("Optional function could not be loaded"),
    };
    if api.nullable_ptr.is_null(){
        println!("Library has a null symbol");
    }
    //while Symbol is good for everything, RefMut requires one less dereference to use
    **api.mut_ref_i32 =34;
    *api.the_same_mut_ref_i32 =35;
    unsafe{**api.not_nullable_ptr = 55.0};
    unsafe{**api.nullable_ptr = 0};
}
```

Please notice several supported features:

* By default `SymBorApi` uses the field name to obtain a symbol from the library.
  You can override the symbol name using the `dlopen2_name` attribute.
* All kind of objects from the `symbor` module implement the Deref or DerefMut trait.
  This means that you can use them as if you would use primitive types that they wrap.
* You can obtain optional symbols. This is very useful when you are dealing with
  different versions of libraries and the new versions support more functions.
  If it is not possible to obtain the given symbol, the option is set to `None',
  otherwise it contains the obtained symbol.
* Both `Symbol` and `Ref` or `RefMut` can be used to obtain references to statically
  allocated objects. But `Ref` and `RefMut` are just easier to use - they require
  less dereferences to access the final value.
  Actually they behave like a normal reference does, it just that they implement the
  `FromRawResult` interface that allows them to be used inside structures that implement
  the `SymBorApi` trait.

*/
pub trait SymBorApi<'a>
where
    Self: Sized,
{
    unsafe fn load(lib: &'a Library) -> Result<Self, Error>;
}
