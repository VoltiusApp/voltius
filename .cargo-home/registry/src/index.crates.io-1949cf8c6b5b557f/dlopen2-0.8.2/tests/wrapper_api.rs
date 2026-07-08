use dlopen2::wrapper::{Container, WrapperApi};
use std::ffi::CStr;
use std::os::raw::{c_char, c_int};

mod commons;
use commons::{SomeData, example_lib_path};

#[derive(WrapperApi)]
struct Api<'a> {
    rust_fun_print_something: fn(),
    rust_fun_add_one: fn(arg: i32) -> i32,
    c_fun_print_something_else: unsafe extern "C" fn(),
    #[dlopen2_name = "c_fun_print_something_else"]
    c_fun_print_something_else_optional: Option<unsafe extern "C" fn()>,
    c_fun_add_two: Option<unsafe extern "C" fn(arg: c_int) -> c_int>,
    c_fun_add_two_not_found: Option<unsafe extern "C" fn(arg: c_int)>,
    rust_i32: &'a i32,
    rust_i32_mut: &'a mut i32,
    #[dlopen2_name = "rust_i32_mut"]
    rust_i32_ptr: *const i32,
    #[dlopen2_name = "rust_i32"]
    rust_i32_optional: Option<&'a i32>,
    rust_i32_not_found: Option<&'a i32>,
    c_int: &'a c_int,
    c_struct: &'a SomeData,
    rust_str: &'a &'static str,
    c_const_char_ptr: *const c_char,
}

//those methods won't be generated
impl<'a> Api<'a> {
    fn rust_i32_ptr(&self) -> *const i32 {
        self.rust_i32_ptr
    }

    fn c_const_str(&self) -> &CStr {
        unsafe { CStr::from_ptr(self.c_const_char_ptr) }
    }
}

#[test]
fn open_play_close_wrapper_api() {
    let lib_path = example_lib_path();
    let mut cont: Container<Api> =
        unsafe { Container::load(lib_path) }.expect("Could not open library or load symbols");

    cont.rust_fun_print_something(); // should not crash
    assert_eq!(cont.rust_fun_add_one(5), 6);
    unsafe { cont.c_fun_print_something_else() }; // should not crash
    unsafe { cont.c_fun_print_something_else_optional() };
    assert!(cont.has_c_fun_print_something_else_optional());
    assert_eq!(unsafe { cont.c_fun_add_two(2) }, Some(4));
    assert!(!cont.has_c_fun_add_two_not_found());
    assert_eq!(unsafe { cont.c_fun_add_two_not_found(2) }, None);
    assert_eq!(43, *cont.rust_i32());
    assert_eq!(42, *cont.rust_i32_mut_mut());
    *cont.rust_i32_mut_mut() = 55; // should not crash
    assert_eq!(55, unsafe { *cont.rust_i32_ptr() });
    assert_eq!(cont.rust_i32_optional(), Some(&43));
    assert_eq!(cont.rust_i32_not_found(), None);

    // the same with C
    assert_eq!(45, *cont.c_int());

    // now static c struct
    assert_eq!(1, cont.c_struct().first);
    assert_eq!(2, cont.c_struct().second);

    // let's play with strings
    assert_eq!("Hello!", *cont.rust_str());
    let converted = cont.c_const_str().to_str().unwrap();
    assert_eq!(converted, "Hi!");
}
