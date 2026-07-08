use dlopen2::symbor::Library;
use std::ffi::CStr;
use std::os::raw::{c_char, c_int};

mod commons;
use commons::{SomeData, example_lib_path};

#[test]
fn open_play_close_symbor() {
    let lib_path = example_lib_path();
    let mut lib = Library::open(lib_path).expect("Could not open library");
    let rust_fun_print_something =
        unsafe { lib.symbol_cstr::<fn()>(c"rust_fun_print_something") }.unwrap();
    rust_fun_print_something(); //should not crash
    let rust_fun_add_one =
        unsafe { lib.symbol_cstr::<fn(i32) -> i32>(c"rust_fun_add_one") }.unwrap();
    assert_eq!(rust_fun_add_one(5), 6);

    let c_fun_print_something_else =
        unsafe { lib.symbol_cstr::<unsafe extern "C" fn()>(c"c_fun_print_something_else") }
            .unwrap();
    unsafe { c_fun_print_something_else() }; //should not crash
    let c_fun_add_two =
        unsafe { lib.symbol_cstr::<unsafe extern "C" fn(c_int) -> c_int>(c"c_fun_add_two") }
            .unwrap();
    assert_eq!(unsafe { c_fun_add_two(2) }, 4);
    let rust_i32: &i32 = unsafe { lib.reference_cstr(c"rust_i32") }.unwrap();
    assert_eq!(43, *rust_i32);
    let rust_i32_mut: &mut i32 = unsafe { lib.reference_mut_cstr(c"rust_i32_mut") }.unwrap();
    assert_eq!(42, *rust_i32_mut);
    *rust_i32_mut = 55; //should not crash
    //for a change use pointer to obtain its value
    let rust_i32_ptr = unsafe { lib.symbol_cstr::<*const i32>(c"rust_i32_mut") }.unwrap();
    assert_eq!(55, unsafe { **rust_i32_ptr });
    //the same with C
    let c_int: &c_int = unsafe { lib.reference_cstr(c"c_int") }.unwrap();
    assert_eq!(45, *c_int);
    //now static c struct

    let c_struct: &SomeData = unsafe { lib.reference_cstr(c"c_struct") }.unwrap();
    assert_eq!(1, c_struct.first);
    assert_eq!(2, c_struct.second);
    //let's play with strings

    let rust_str: &&str = unsafe { lib.reference_cstr(c"rust_str") }.unwrap();
    assert_eq!("Hello!", *rust_str);
    let c_const_char_ptr =
        unsafe { lib.symbol_cstr::<*const c_char>(c"c_const_char_ptr") }.unwrap();
    let converted = unsafe { CStr::from_ptr(*c_const_char_ptr) }
        .to_str()
        .unwrap();
    assert_eq!(converted, "Hi!");
}
