use dlopen2::symbor::{Library, PtrOrNull, Ref, RefMut, SymBorApi, Symbol};
use std::ffi::CStr;
use std::os::raw::{c_char, c_int};

mod commons;
use commons::{SomeData, example_lib_path};

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

#[test]
fn open_play_close_symbor_api() {
    let lib_path = example_lib_path();
    let lib = Library::open(lib_path).expect("Could not open library");
    let mut api = unsafe { Api::load(&lib) }.expect("Could not load symbols");
    (api.rust_fun_print_something)(); //should not crash
    assert_eq!((api.rust_fun_add_one)(5), 6);
    unsafe { (api.c_fun_print_something_else)() }; //should not crash
    assert_eq!(unsafe { (api.c_fun_add_two)(2) }, 4);
    assert_eq!(43, *api.rust_i32);
    assert_eq!(42, *api.rust_i32_mut);
    *api.rust_i32_mut = 55; //should not crash
    assert_eq!(55, unsafe { **api.rust_i32_ptr });
    //the same with C
    assert_eq!(45, *api.c_int);
    //now static c struct

    assert_eq!(1, api.c_struct.first);
    assert_eq!(2, api.c_struct.second);
    //let's play with strings

    assert_eq!("Hello!", *api.rust_str);
    let converted = unsafe { CStr::from_ptr(*api.c_const_char_ptr) }
        .to_str()
        .unwrap();
    assert_eq!(converted, "Hi!");
}
