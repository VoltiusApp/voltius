mod commons;

use commons::example_lib_path;
use dlopen2::raw::{AddressInfoObtainer, Library};
use std::os::raw::c_int;

fn main() {
    let lib_path = example_lib_path();
    let lib = Library::open(&lib_path).expect("Could not open library");
    let c_fun_add_two: unsafe extern "C" fn(c_int) -> c_int =
        unsafe { lib.symbol("c_fun_add_two") }.unwrap();
    let aio = AddressInfoObtainer::new();
    let ai = unsafe { aio.obtain(c_fun_add_two as *const ()) }.unwrap();
    println!("{:?}", &ai);
    assert_eq!(&ai.dll_path, lib_path.to_str().unwrap());
    let os = ai.overlapping_symbol.unwrap();
    assert_eq!(os.name, "c_fun_add_two");
    assert_eq!(os.addr, c_fun_add_two as *const ())
}
