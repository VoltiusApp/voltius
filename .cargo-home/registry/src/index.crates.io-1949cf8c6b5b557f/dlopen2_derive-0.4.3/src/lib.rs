#![recursion_limit = "128"]

extern crate proc_macro;
extern crate quote;
extern crate syn;

mod api;
mod common;
mod multi_api;
mod wrapper;

use api::impl_library_api;
use multi_api::impl_wrapper_multi_api;
use proc_macro::TokenStream;
use syn::{DeriveInput, parse_macro_input};
use wrapper::impl_wrapper_api;

#[proc_macro_derive(WrapperApi, attributes(dlopen2_name, dlopen2_allow_null))]
pub fn wrapper_api(input: TokenStream) -> TokenStream {
    // Parse the string representation
    let ast = parse_macro_input!(input as DeriveInput);

    // Build the impl
    let wrapper = impl_wrapper_api(&ast);

    // Return the generated impl
    TokenStream::from(wrapper)
}

#[proc_macro_derive(WrapperMultiApi)]
pub fn wrapper_multi_api(input: TokenStream) -> TokenStream {
    // Parse the string representation
    let ast = parse_macro_input!(input as DeriveInput);

    // Build the impl
    let wrapper = impl_wrapper_multi_api(&ast);

    // Return the generated impl
    TokenStream::from(wrapper)
}

#[proc_macro_derive(SymBorApi, attributes(dlopen2_name))]
pub fn library_api(input: TokenStream) -> TokenStream {
    // Parse the string representation
    let ast = parse_macro_input!(input as DeriveInput);

    // Build the impl
    let library = impl_library_api(&ast);

    // Return the generated impl
    TokenStream::from(library)
}
