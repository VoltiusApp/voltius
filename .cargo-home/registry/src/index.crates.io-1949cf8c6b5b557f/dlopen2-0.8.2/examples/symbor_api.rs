mod commons;

use commons::{SomeData, example_lib_path};
use dlopen2::symbor::{Library, PtrOrNull, Ref, RefMut, SymBorApi, Symbol};
use std::ffi::CStr;
use std::os::raw::{c_char, c_int};

#[derive(SymBorApi)]
struct Api<'a> {
    pub rust_fun_print_something: Symbol<'a, fn()>,
    pub rust_fun_add_one: Symbol<'a, fn(i32) -> i32>,
    pub c_fun_print_something_else: Symbol<'a, unsafe extern "C" fn()>,
    pub c_fun_add_two: Symbol<'a, unsafe extern "C" fn(c_int) -> c_int>,
    pub rust_i32: Ref<'a, i32>,
    pub rust_i32_mut: RefMut<'a, i32>,
    #[dlopen2_name = "rust_i32_mut"]
    pub rust_i32_ptr: Symbol<'a, *const i32>,
    pub c_int: Ref<'a, c_int>,
    pub c_struct: Ref<'a, SomeData>,
    pub rust_str: Ref<'a, &'static str>,
    pub c_const_char_ptr: PtrOrNull<'a, c_char>,
}

fn main() {
    let lib_path = example_lib_path();
    let lib = Library::open(lib_path).expect("Could not open library");
    let mut api = unsafe { Api::load(&lib) }.expect("Could not load the API");

    (api.rust_fun_print_something)();

    println!(" 5+1={}", (api.rust_fun_add_one)(5));

    unsafe { (api.c_fun_print_something_else)() };

    println!("2+2={}", unsafe { (api.c_fun_add_two)(2) });

    println!("const rust i32 value: {}", *api.rust_i32);

    println!("mutable rust i32 value: {}", *api.rust_i32_mut);

    *api.rust_i32_mut = 55;

    //for a change use pointer to obtain its value
    println!("after change: {}", unsafe { **api.rust_i32_ptr });

    //the same with C
    println!("c_int={}", *api.c_int);

    //now static c struct
    println!(
        "c struct first: {}, second:{}",
        api.c_struct.first, api.c_struct.second
    );

    //let's play with strings
    println!("Rust says: {}", *api.rust_str);

    let converted = unsafe { CStr::from_ptr(*api.c_const_char_ptr) }
        .to_str()
        .unwrap();
    println!("And now C says: {converted}");
}
