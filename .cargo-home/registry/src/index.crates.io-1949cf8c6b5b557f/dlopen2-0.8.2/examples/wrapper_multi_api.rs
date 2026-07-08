mod commons;
use commons::example_lib_path;

use dlopen2::wrapper::{Container, WrapperApi, WrapperMultiApi};
use std::os::raw::c_int;

//Define 3 APIs:

#[derive(WrapperApi)]
struct Working1<'a> {
    rust_fun_print_something: fn(),
    c_fun_add_two: unsafe extern "C" fn(arg: c_int) -> c_int,
    rust_i32_mut: &'a mut i32,
}

#[derive(WrapperApi)]
struct Working2<'a> {
    rust_fun_add_one: fn(arg: i32) -> i32,
    c_fun_print_something_else: extern "C" fn(),
    rust_i32: &'a i32,
}

//this one wont' work in the example
#[derive(WrapperApi)]
struct NotWorking<'a> {
    some_rust_fun: fn(arg: i32) -> i32,
    some_c_fun: extern "C" fn(),
    some_rust_num: &'a u32,
}

//Now define a multi wrapper that wraps sub APIs into one bigger API.
//This example assumes that the first API is obligatory and the other two are optional.

#[derive(WrapperMultiApi)]
struct Api<'a> {
    pub obligatory: Working1<'a>,
    pub optional1: Option<Working2<'a>>,
    pub optional2: Option<NotWorking<'a>>,
}

fn main() {
    let lib_path = example_lib_path();
    let api: Container<Api> = unsafe { Container::load(lib_path) }.expect("Could not open library");
    //use obligatory API:
    api.obligatory.rust_fun_print_something();
    println!("4+2={}", unsafe { api.obligatory.c_fun_add_two(4) });
    println!("static i32={}", api.obligatory.rust_i32_mut());

    match api.optional1 {
        Some(ref opt) => {
            println!("First optional API loaded!");
            println!("3+1={}", opt.rust_fun_add_one(3));
            opt.c_fun_print_something_else();
            println!("static value is {}", opt.rust_i32())
        }
        None => println!("Could not load the first optional API"),
    }

    match api.optional2 {
        Some(ref opt) => {
            opt.some_c_fun();
            println!("Second optional API loaded");
            println!("result of some function: {}", opt.some_rust_fun(3));
            println!("static value is {}", opt.some_rust_num());
        }
        None => println!("Could not load the second optional API"),
    }
}
