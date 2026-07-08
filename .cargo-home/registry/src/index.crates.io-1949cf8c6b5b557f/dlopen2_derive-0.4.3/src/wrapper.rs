use super::common::{get_fields, get_non_marker_attrs, has_marker_attr, symbol_name};
use quote::quote;
use syn::{self, BareFnArg, DeriveInput, Field, GenericArgument, Type, TypePtr, Visibility};

const ALLOW_NULL: &str = "dlopen2_allow_null";
const TRAIT_NAME: &str = "WrapperApi";

pub fn impl_wrapper_api(ast: &DeriveInput) -> proc_macro2::TokenStream {
    let struct_name = &ast.ident;
    let fields = get_fields(ast, TRAIT_NAME);
    let generics = &ast.generics;
    // make sure that all fields are private - panic otherwise
    // make sure that all fields are identifiable - panic otherwise
    for field in fields.named.iter() {
        let _ = field
            .ident
            .as_ref()
            .expect("All fields of structures deriving WrapperAPI need to be identificable");
        match field.vis {
            Visibility::Inherited => (),
            _ => panic!(
                "All fields of structures deriving {} need to be private and '{}' is not",
                TRAIT_NAME,
                field.ident.as_ref().unwrap()
            ),
        }
    }

    let field_iter = fields.named.iter().map(field_to_tokens);
    let wrapper_iter = fields.named.iter().filter_map(field_to_wrapper);
    let q = quote! {
        impl #generics WrapperApi for #struct_name #generics {
            unsafe fn load(lib: & ::dlopen2::raw::Library ) -> ::std::result::Result<Self, ::dlopen2::Error> {
                Ok(Self{
                    #(#field_iter),*
                })
            }
        }

        #[allow(dead_code)]
        impl #generics #struct_name #generics {
            #(#wrapper_iter)*
        }
    };

    q
}

fn field_to_tokens(field: &Field) -> proc_macro2::TokenStream {
    let allow_null = has_marker_attr(field, ALLOW_NULL);
    match skip_groups(&field.ty) {
        Type::BareFn(_) | Type::Reference(_) => {
            if allow_null {
                panic!("Only pointers can have the '{ALLOW_NULL}' attribute assigned");
            }
            normal_field(field)
        }
        Type::Ptr(ptr) => {
            if allow_null {
                allow_null_field(field, ptr)
            } else {
                normal_field(field)
            }
        }
        Type::Path(rpath) => {
            let path = &rpath.path;
            let segments_string: Vec<String> = path
                .segments
                .iter()
                .map(|segment| segment.ident.to_string())
                .collect();
            let segments_str: Vec<&str> = segments_string
                .iter()
                .map(|segment| segment.as_str())
                .collect();
            match (path.leading_colon.is_some(), segments_str.as_slice()) {
                (_, ["core" | "std", "option", "Option"])
                | (false, ["option", "Option"])
                | (false, ["Option"]) => optional_field(field),
                _ => panic!(
                    "Only bare functions, optional bare functions, references and pointers are allowed in structures implementing WrapperApi trait"
                ),
            }
        }
        _ => {
            panic!(
                "Only bare functions, references and pointers are allowed in structures implementing WrapperApi trait not {:?}",
                field.ty
            );
        }
    }
}

fn normal_field(field: &Field) -> proc_macro2::TokenStream {
    let field_name = &field.ident;
    let symbol_name = symbol_name(field);
    quote! {
        #field_name : lib.symbol_cstr(
            ::std::ffi::CStr::from_bytes_with_nul_unchecked(concat!(#symbol_name, "\0").as_bytes())
        )?
    }
}

fn allow_null_field(field: &Field, ptr: &TypePtr) -> proc_macro2::TokenStream {
    let field_name = &field.ident;
    let symbol_name = symbol_name(field);
    let null_fun = match ptr.mutability {
        Some(_) => quote! {null},
        None => quote! {null_mut},
    };

    quote! {
        #field_name : match lib.symbol_cstr(
            ::std::ffi::CStr::from_bytes_with_nul_unchecked(concat!(#symbol_name, "\0").as_bytes())
        ) {
            ::std::result::Result::Ok(val) => val,
            ::std::result::Result::Err(err) => match err {
                ::dlopen2::Error::NullSymbol => ::std::ptr:: #null_fun (),
                _ => return ::std::result::Result::Err(err)
            }
        }
    }
}

fn optional_field(field: &Field) -> proc_macro2::TokenStream {
    let field_name = &field.ident;
    let symbol_name = symbol_name(field);

    let tokens = quote! {
        #field_name : match lib.symbol_cstr(
            ::std::ffi::CStr::from_bytes_with_nul_unchecked(concat!(#symbol_name, "\0").as_bytes())
        ) {
            ::std::result::Result::Ok(val) => Some(val),
            ::std::result::Result::Err(err) => match err {
                ::dlopen2::Error::NullSymbol => None,
                ::dlopen2::Error::SymbolGettingError(_) => None,
                _ => return ::std::result::Result::Err(err)
            }
        }
    };
    tokens
}

fn skip_groups(ty: &Type) -> &Type {
    match ty {
        Type::Group(group) => skip_groups(&group.elem),
        _ => ty,
    }
}

fn field_to_wrapper(field: &Field) -> Option<proc_macro2::TokenStream> {
    let ident = field
        .ident
        .as_ref()
        .expect("Fields must have idents (tuple structs are not supported)");
    let attrs = get_non_marker_attrs(field);

    match skip_groups(&field.ty) {
        Type::BareFn(fun) => {
            if fun.variadic.is_some() {
                None
            } else {
                let output = &fun.output;
                let unsafety = &fun.unsafety;
                let arg_iter = fun
                    .inputs
                    .iter()
                    .map(|a| fun_arg_to_tokens(a, &ident.to_string()));
                let arg_names = fun.inputs.iter().map(|a| match a.name {
                    ::std::option::Option::Some((ref arg_name, _)) => arg_name,
                    ::std::option::Option::None => unreachable!(),
                });
                Some(quote! {
                    #(#attrs)*
                    pub #unsafety fn #ident (&self, #(#arg_iter),* ) #output {
                        (self.#ident)(#(#arg_names),*)
                    }
                })
            }
        }
        Type::Reference(ref_ty) => {
            let ty = &ref_ty.elem;
            let mut_acc = match ref_ty.mutability {
                Some(_token) => {
                    let mut_ident = &format!("{ident}_mut");
                    let method_name = syn::Ident::new(mut_ident, ident.span());
                    Some(quote! {
                        #(#attrs)*
                        pub fn #method_name (&mut self) -> &mut #ty {
                            self.#ident
                        }
                    })
                }
                None => None,
            };
            // constant accessor
            let const_acc = quote! {
                #(#attrs)*
                pub fn #ident (&self) -> & #ty {
                    self.#ident
                }
            };

            Some(quote! {
                #const_acc
                #mut_acc
            })
        }
        Type::Ptr(_) => None,
        // For `field: Option<fn(...) -> ...>`
        Type::Path(path) => {
            let path = &path.path;
            let segments = &path.segments;
            let segment = segments
                .iter()
                .find(|segment| segment.ident == "Option")
                .unwrap();
            let args = &segment.arguments;
            match args {
                syn::PathArguments::AngleBracketed(args) => match args.args.first().unwrap() {
                    GenericArgument::Type(ty) => match skip_groups(ty) {
                        Type::BareFn(fun) => {
                            if fun.variadic.is_some() {
                                None
                            } else {
                                let output = &fun.output;
                                let output = match output {
                                    syn::ReturnType::Default => quote!(-> Option<()>),
                                    syn::ReturnType::Type(_, ty) => quote!( -> Option<#ty>),
                                };
                                let unsafety = &fun.unsafety;
                                let arg_iter = fun
                                    .inputs
                                    .iter()
                                    .map(|a| fun_arg_to_tokens(a, &ident.to_string()));
                                let arg_names = fun.inputs.iter().map(|a| match a.name {
                                    ::std::option::Option::Some((ref arg_name, _)) => arg_name,
                                    ::std::option::Option::None => unreachable!(),
                                });
                                let has_ident = quote::format_ident!("has_{}", ident);
                                Some(quote! {
                                    #(#attrs)*
                                    pub #unsafety fn #ident (&self, #(#arg_iter),* ) #output {
                                        self.#ident.map(|f| (f)(#(#arg_names),*))
                                    }
                                    #(#attrs)*
                                    pub fn #has_ident (&self) -> bool {
                                        self.#ident.is_some()
                                    }
                                })
                            }
                        }
                        Type::Reference(ref_ty) => {
                            let ty = &ref_ty.elem;
                            match ref_ty.mutability {
                                Some(_token) => {
                                    let mut_ident = &format!("{ident}");
                                    let method_name = syn::Ident::new(mut_ident, ident.span());
                                    Some(quote! {
                                        #(#attrs)*
                                        pub fn #method_name (&mut self) -> ::core::option::Option<&mut #ty> {
                                            if let Some(&mut ref mut val) = self.#ident {
                                                Some(val)
                                            } else {
                                                None
                                            }
                                        }
                                    })
                                }
                                None => Some(quote! {
                                    #(#attrs)*
                                    pub fn #ident (&self) -> ::core::option::Option<& #ty> {
                                        self.#ident
                                    }
                                }),
                            }
                        }
                        _ => panic!("Unsupported field type"),
                    },
                    _ => panic!("Unknown optional type!"),
                },
                _ => panic!("Unknown optional type!"),
            }
        }
        _ => panic!("Unsupported field type"),
    }
}

fn fun_arg_to_tokens(arg: &BareFnArg, function_name: &str) -> proc_macro2::TokenStream {
    let arg_name = match arg.name {
        Some(ref val) => &val.0,
        None => panic!("Function {function_name} has an unnamed argument."),
    };
    let ty = &arg.ty;
    quote! {
        #arg_name: #ty
    }
}
