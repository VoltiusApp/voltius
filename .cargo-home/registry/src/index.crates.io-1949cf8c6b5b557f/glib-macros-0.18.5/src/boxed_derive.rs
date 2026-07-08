// Take a look at the license at the top of the repository in the LICENSE file.

use proc_macro2::{Ident, TokenStream};
use proc_macro_error::abort_call_site;
use quote::quote;

use crate::utils::{crate_ident_new, parse_nested_meta_items, NestedMetaItem};

fn gen_option_to_ptr() -> TokenStream {
    quote! {
        match s {
            ::core::option::Option::Some(s) => ::std::boxed::Box::into_raw(::std::boxed::Box::new(s.clone())),
            ::core::option::Option::None => ::std::ptr::null_mut(),
        };
    }
}

fn gen_impl_from_value_optional(name: &Ident, crate_ident: &TokenStream) -> TokenStream {
    quote! {
        unsafe impl<'a> #crate_ident::value::FromValue<'a> for #name {
            type Checker = #crate_ident::value::GenericValueTypeOrNoneChecker<Self>;

            #[inline]
            unsafe fn from_value(value: &'a #crate_ident::Value) -> Self {
                let ptr = #crate_ident::gobject_ffi::g_value_dup_boxed(#crate_ident::translate::ToGlibPtr::to_glib_none(value).0);
                debug_assert!(!ptr.is_null());
                *::std::boxed::Box::from_raw(ptr as *mut #name)
            }
        }

        unsafe impl<'a> #crate_ident::value::FromValue<'a> for &'a #name {
            type Checker = #crate_ident::value::GenericValueTypeOrNoneChecker<Self>;

            #[inline]
            unsafe fn from_value(value: &'a #crate_ident::Value) -> Self {
                let ptr = #crate_ident::gobject_ffi::g_value_get_boxed(#crate_ident::translate::ToGlibPtr::to_glib_none(value).0);
                debug_assert!(!ptr.is_null());
                &*(ptr as *mut #name)
            }
        }
    }
}

fn gen_impl_from_value(name: &Ident, crate_ident: &TokenStream) -> TokenStream {
    quote! {
        unsafe impl<'a> #crate_ident::value::FromValue<'a> for #name {
            type Checker = #crate_ident::value::GenericValueTypeChecker<Self>;

            #[inline]
            unsafe fn from_value(value: &'a #crate_ident::Value) -> Self {
                let ptr = #crate_ident::gobject_ffi::g_value_dup_boxed(#crate_ident::translate::ToGlibPtr::to_glib_none(value).0);
                debug_assert!(!ptr.is_null());
                *::std::boxed::Box::from_raw(ptr as *mut #name)
            }
        }

        unsafe impl<'a> #crate_ident::value::FromValue<'a> for &'a #name {
            type Checker = #crate_ident::value::GenericValueTypeChecker<Self>;

            #[inline]
            unsafe fn from_value(value: &'a #crate_ident::Value) -> Self {
                let ptr = #crate_ident::gobject_ffi::g_value_get_boxed(#crate_ident::translate::ToGlibPtr::to_glib_none(value).0);
                debug_assert!(!ptr.is_null());
                &*(ptr as *mut #name)
            }
        }
    }
}

fn gen_impl_to_value_optional(name: &Ident, crate_ident: &TokenStream) -> TokenStream {
    let option_to_ptr = gen_option_to_ptr();

    quote! {
        impl #crate_ident::value::ToValueOptional for #name {
            #[inline]
            fn to_value_optional(s: ::core::option::Option<&Self>) -> #crate_ident::Value {
                let mut value = #crate_ident::Value::for_value_type::<Self>();
                unsafe {
                    let ptr: *mut #name = #option_to_ptr;
                    #crate_ident::gobject_ffi::g_value_take_boxed(
                        #crate_ident::translate::ToGlibPtrMut::to_glib_none_mut(&mut value).0,
                        ptr as *mut _
                    );
                }

                value
            }
        }

        impl #crate_ident::value::ValueTypeOptional for #name { }
    }
}

pub fn impl_boxed(input: &syn::DeriveInput) -> TokenStream {
    let name = &input.ident;

    let mut gtype_name = NestedMetaItem::<syn::LitStr>::new("name")
        .required()
        .value_required();
    let mut nullable = NestedMetaItem::<syn::LitBool>::new("nullable").value_optional();

    let found = parse_nested_meta_items(
        &input.attrs,
        "boxed_type",
        &mut [&mut gtype_name, &mut nullable],
    );

    match found {
        Ok(None) => {
            abort_call_site!(
                "#[derive(glib::Boxed)] requires #[boxed_type(name = \"BoxedTypeName\")]"
            )
        }
        Err(e) => return e.to_compile_error(),
        Ok(_) => {}
    };

    let gtype_name = gtype_name.value.unwrap();
    let nullable = nullable.found || nullable.value.map(|b| b.value()).unwrap_or(false);

    let crate_ident = crate_ident_new();

    let impl_from_value = if !nullable {
        gen_impl_from_value(name, &crate_ident)
    } else {
        gen_impl_from_value_optional(name, &crate_ident)
    };
    let impl_to_value_optional = if nullable {
        gen_impl_to_value_optional(name, &crate_ident)
    } else {
        quote! {}
    };

    quote! {
        impl #crate_ident::subclass::boxed::BoxedType for #name {
            const NAME: &'static ::core::primitive::str = #gtype_name;
        }

        impl #crate_ident::StaticType for #name {
            #[inline]
            fn static_type() -> #crate_ident::Type {
                static ONCE: ::std::sync::Once = ::std::sync::Once::new();
                static mut TYPE_: #crate_ident::Type = #crate_ident::Type::INVALID;

                ONCE.call_once(|| {
                    let type_ = #crate_ident::subclass::register_boxed_type::<#name>();
                    unsafe {
                        TYPE_ = type_;
                    }
                });

                unsafe {
                    TYPE_
                }
            }
        }

        impl #crate_ident::value::ValueType for #name {
            type Type = #name;
        }

        impl #crate_ident::value::ToValue for #name {
            #[inline]
            fn to_value(&self) -> #crate_ident::Value {
                unsafe {
                    let ptr: *mut #name = ::std::boxed::Box::into_raw(::std::boxed::Box::new(self.clone()));
                    let mut value = #crate_ident::Value::from_type_unchecked(<#name as #crate_ident::StaticType>::static_type());
                    #crate_ident::gobject_ffi::g_value_take_boxed(
                        #crate_ident::translate::ToGlibPtrMut::to_glib_none_mut(&mut value).0,
                        ptr as *mut _
                    );
                    value
                }
            }

            #[inline]
            fn value_type(&self) -> #crate_ident::Type {
                <#name as #crate_ident::StaticType>::static_type()
            }
        }

        impl ::std::convert::From<#name> for #crate_ident::Value {
            #[inline]
            fn from(v: #name) -> Self {
                unsafe {
                    let mut value = #crate_ident::Value::from_type_unchecked(<#name as #crate_ident::StaticType>::static_type());
                    #crate_ident::gobject_ffi::g_value_take_boxed(
                        #crate_ident::translate::ToGlibPtrMut::to_glib_none_mut(&mut value).0,
                        #crate_ident::translate::IntoGlibPtr::<*mut #name>::into_glib_ptr(v) as *mut _,
                    );
                    value
                }
            }
        }

        #impl_to_value_optional

        #impl_from_value

        impl #crate_ident::translate::GlibPtrDefault for #name {
            type GlibType = *mut #name;
        }

        impl #crate_ident::translate::FromGlibPtrBorrow<*const #name> for #name {
            #[inline]
            unsafe fn from_glib_borrow(ptr: *const #name) -> #crate_ident::translate::Borrowed<Self> {
                #crate_ident::translate::FromGlibPtrBorrow::from_glib_borrow(ptr as *mut _)
            }
        }

        impl #crate_ident::translate::FromGlibPtrBorrow<*mut #name> for #name {
            #[inline]
            unsafe fn from_glib_borrow(ptr: *mut #name) -> #crate_ident::translate::Borrowed<Self> {
                debug_assert!(!ptr.is_null());

                #crate_ident::translate::Borrowed::new(std::ptr::read(ptr))
            }
        }

        impl #crate_ident::translate::FromGlibPtrNone<*const #name> for #name {
            #[inline]
            unsafe fn from_glib_none(ptr: *const #name) -> Self {
                debug_assert!(!ptr.is_null());
                (&*ptr).clone()
            }
        }

        impl #crate_ident::translate::FromGlibPtrNone<*mut #name> for #name {
            #[inline]
            unsafe fn from_glib_none(ptr: *mut #name) -> Self {
                #crate_ident::translate::FromGlibPtrNone::from_glib_none(ptr as *const _)
            }
        }

        impl #crate_ident::translate::FromGlibPtrFull<*mut #name> for #name {
            #[inline]
            unsafe fn from_glib_full(ptr: *mut #name) -> Self {
                debug_assert!(!ptr.is_null());
                *::std::boxed::Box::from_raw(ptr)
            }
        }

        impl #crate_ident::translate::IntoGlibPtr<*mut #name> for #name {
            #[inline]
            unsafe fn into_glib_ptr(self) -> *mut #name {
                ::std::boxed::Box::into_raw(::std::boxed::Box::new(self)) as *mut _
            }
        }

        impl<'a> #crate_ident::translate::ToGlibPtr<'a, *const #name> for #name {
            type Storage = std::marker::PhantomData<&'a Self>;

            #[inline]
            fn to_glib_none(&'a self) -> #crate_ident::translate::Stash<'a, *const #name, Self> {
                #crate_ident::translate::Stash(self as *const #name, std::marker::PhantomData)
            }

            #[inline]
            fn to_glib_full(&self) -> *const #name {
                ::std::boxed::Box::into_raw(::std::boxed::Box::new(self.clone()))
            }
        }

        impl<'a> #crate_ident::translate::ToGlibPtr<'a, *mut #name> for #name {
            type Storage = std::marker::PhantomData<&'a Self>;

            #[inline]
            fn to_glib_none(&'a self) -> #crate_ident::translate::Stash<'a, *mut #name, Self> {
                #crate_ident::translate::Stash(self as *const #name as *mut _, std::marker::PhantomData)
            }

            #[inline]
            fn to_glib_full(&self) -> *mut #name {
                ::std::boxed::Box::into_raw(::std::boxed::Box::new(self.clone())) as *mut _
            }
        }

        impl #crate_ident::HasParamSpec for #name {
            type ParamSpec = #crate_ident::ParamSpecBoxed;
            type SetValue = Self;
            type BuilderFn = fn(&::core::primitive::str) -> #crate_ident::ParamSpecBoxedBuilder<Self>;

            fn param_spec_builder() -> Self::BuilderFn {
                |name| Self::ParamSpec::builder(name)
            }
        }
    }
}
