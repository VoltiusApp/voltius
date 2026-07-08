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
    c_fun_add_two: unsafe extern "C" fn(arg: c_int) -> c_int,
    rust_i32: &'a i32,
    rust_i32_mut: &'a mut i32,
    #[dlopen2_name = "rust_i32_mut"]
    rust_i32_ptr: *const i32,
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

fn main() {
    let lib_path = example_lib_path();
    let mut cont: Container<Api> =
        unsafe { Container::load(lib_path) }.expect("Could not open library or load symbols");

    cont.rust_fun_print_something();
    println!(" 5+1={}", cont.rust_fun_add_one(5));
    unsafe { cont.c_fun_print_something_else() };
    println!("2+2={}", unsafe { cont.c_fun_add_two(2) });
    println!("const rust i32 value: {}", *cont.rust_i32());
    println!("mutable rust i32 value: {}", *cont.rust_i32_mut());
    *cont.rust_i32_mut_mut() = 55;
    println!("after change: {}", unsafe { *cont.rust_i32_ptr() });
    //the same with C
    println!("c_int={}", *cont.c_int());
    //now static c struct

    println!(
        "c struct first: {}, second:{}",
        cont.c_struct().first,
        cont.c_struct().second
    );
    //let's play with strings

    println!("Rust says: {}", *cont.rust_str());
    let converted = cont.c_const_str().to_str().unwrap();
    println!("And now C says: {converted}");
}
