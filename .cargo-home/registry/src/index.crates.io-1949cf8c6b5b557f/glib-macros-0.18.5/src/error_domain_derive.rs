// Take a look at the license at the top of the repository in the LICENSE file.

use proc_macro2::TokenStream;
use proc_macro_error::abort_call_site;
use quote::quote;
use syn::Data;

use crate::utils::{crate_ident_new, gen_enum_from_glib, parse_nested_meta_items, NestedMetaItem};

pub fn impl_error_domain(input: &syn::DeriveInput) -> TokenStream {
    let name = &input.ident;

    let enum_variants = match input.data {
        Data::Enum(ref e) => &e.variants,
        _ => abort_call_site!("#[derive(glib::ErrorDomain)] only supports enums"),
    };

    let mut domain_name = NestedMetaItem::<syn::LitStr>::new("name")
        .required()
        .value_required();
    let found = parse_nested_meta_items(&input.attrs, "error_domain", &mut [&mut domain_name]);

    match found {
        Ok(None) => {
            abort_call_site!(
                "#[derive(glib::ErrorDomain)] requires #[error_domain(name = \"domain-name\")]"
            )
        }
        Err(e) => return e.to_compile_error(),
        Ok(_) => (),
    };
    let domain_name = domain_name.value.unwrap();
    let crate_ident = crate_ident_new();

    let from_glib = gen_enum_from_glib(name, enum_variants);

    quote! {
        impl #crate_ident::error::ErrorDomain for #name {
            #[inline]
            fn domain() -> #crate_ident::Quark {
                use #crate_ident::translate::from_glib;

                static QUARK: #crate_ident::once_cell::sync::Lazy<#crate_ident::Quark> =
                    #crate_ident::once_cell::sync::Lazy::new(|| unsafe {
                        from_glib(#crate_ident::ffi::g_quark_from_static_string(concat!(#domain_name, "\0") as *const ::core::primitive::str as *const _))
                    });
                *QUARK
            }

            #[inline]
            fn code(self) -> i32 {
                self as i32
            }

            #[inline]
            fn from(value: i32) -> ::core::option::Option<Self>
            where
                Self: ::std::marker::Sized
            {
                #from_glib
            }
        }
    }
}
