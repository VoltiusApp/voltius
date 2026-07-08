// Take a look at the license at the top of the repository in the LICENSE file.

use proc_macro2::TokenStream;
use proc_macro_error::abort_call_site;
use quote::quote;

pub const WRONG_PLACE_MSG: &str =
    "This macro should be used on `impl` block for `glib::ObjectInterface` trait";

pub fn impl_object_interface(input: &syn::ItemImpl) -> TokenStream {
    let mut has_prerequisites = false;
    for item in &input.items {
        if let syn::ImplItem::Type(type_) = item {
            let name = type_.ident.to_string();
            if name == "Prerequisites" {
                has_prerequisites = true;
            }
        }
    }

    let syn::ItemImpl {
        attrs,
        generics,
        trait_,
        self_ty,
        unsafety,
        items,
        ..
    } = &input;

    let prerequisites_opt = if has_prerequisites {
        None
    } else {
        Some(quote!(
            type Prerequisites = ();
        ))
    };

    let crate_ident = crate::utils::crate_ident_new();

    let trait_path = match &trait_ {
        Some(path) => &path.1,
        None => abort_call_site!(WRONG_PLACE_MSG),
    };

    quote! {
        #(#attrs)*
        #unsafety impl #generics #trait_path for #self_ty {
            #prerequisites_opt
            #(#items)*
        }

        unsafe impl #crate_ident::subclass::interface::ObjectInterfaceType for #self_ty {
            #[inline]
            fn type_() -> #crate_ident::Type {
                static ONCE: ::std::sync::Once = ::std::sync::Once::new();
                static mut TYPE: #crate_ident::Type = #crate_ident::Type::INVALID;

                ONCE.call_once(|| {
                    let type_ = #crate_ident::subclass::register_interface::<Self>();
                    unsafe {
                        TYPE = type_;
                    }
                });

                unsafe {
                    TYPE
                }
            }
        }
    }
}
