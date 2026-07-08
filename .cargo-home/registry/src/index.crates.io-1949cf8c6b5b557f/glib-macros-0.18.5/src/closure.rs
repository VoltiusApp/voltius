// Take a look at the license at the top of the repository in the LICENSE file.

use proc_macro2::{Ident, Span, TokenStream};
use proc_macro_error::abort;
use quote::{quote, ToTokens, TokenStreamExt};
use syn::{ext::IdentExt, spanned::Spanned, Token};

use crate::utils::crate_ident_new;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum CaptureKind {
    Watch,
    WeakAllowNone,
    Strong,
    ToOwned,
}

struct Capture {
    name: TokenStream,
    alias: Option<syn::Ident>,
    kind: CaptureKind,
    start: Span,
}

impl Capture {
    fn alias(&self) -> TokenStream {
        if let Some(ref a) = self.alias {
            a.to_token_stream()
        } else {
            self.name.to_token_stream()
        }
    }
    fn outer_before_tokens(&self, crate_ident: &TokenStream) -> TokenStream {
        let alias = self.alias();
        let name = &self.name;
        match self.kind {
            CaptureKind::Watch => quote! {
                let #alias = #crate_ident::object::Watchable::watched_object(&#name);
            },
            CaptureKind::WeakAllowNone => quote! {
                let #alias = #crate_ident::clone::Downgrade::downgrade(&#name);
            },
            CaptureKind::Strong => quote! {
                let #alias = #name.clone();
            },
            CaptureKind::ToOwned => quote! {
                let #alias = ::std::borrow::ToOwned::to_owned(&*#name);
            },
        }
    }

    fn outer_after_tokens(&self, crate_ident: &TokenStream, closure_ident: &Ident) -> TokenStream {
        let name = &self.name;
        match self.kind {
            CaptureKind::Watch => quote! {
                #crate_ident::object::Watchable::watch_closure(&#name, &#closure_ident);
            },
            _ => Default::default(),
        }
    }

    fn inner_before_tokens(&self, crate_ident: &TokenStream) -> TokenStream {
        let alias = self.alias();
        match self.kind {
            CaptureKind::Watch => {
                quote! {
                    let #alias = unsafe { #alias.borrow() };
                    let #alias = ::core::convert::AsRef::as_ref(&#alias);
                }
            }
            CaptureKind::WeakAllowNone => quote! {
                let #alias = #crate_ident::clone::Upgrade::upgrade(&#alias);
            },
            _ => Default::default(),
        }
    }
}

impl syn::parse::Parse for CaptureKind {
    fn parse(input: syn::parse::ParseStream) -> syn::Result<Self> {
        input.parse::<Token![@]>()?;
        let mut idents = TokenStream::new();
        idents.append(input.call(syn::Ident::parse_any)?);
        while input.peek(Token![-]) {
            input.parse::<Token![-]>()?;
            idents.append(input.call(syn::Ident::parse_any)?);
        }
        let keyword = idents
            .clone()
            .into_iter()
            .map(|i| i.to_string())
            .collect::<Vec<_>>()
            .join("-");
        Ok(match keyword.as_str() {
            "strong" => CaptureKind::Strong,
            "watch" => CaptureKind::Watch,
            "weak-allow-none" => CaptureKind::WeakAllowNone,
            "to-owned" => CaptureKind::ToOwned,
            k => abort!(
                idents,
                "Unknown keyword `{}`, only `watch`, `weak-allow-none`, `to-owned` and `strong` are allowed",
                k,
            ),
        })
    }
}

impl syn::parse::Parse for Capture {
    fn parse(input: syn::parse::ParseStream) -> syn::Result<Self> {
        let start = input.span();
        let kind = input.parse()?;
        let mut name = TokenStream::new();
        name.append(input.call(syn::Ident::parse_any)?);
        while input.peek(Token![.]) {
            input.parse::<Token![.]>()?;
            name.append(proc_macro2::Punct::new('.', proc_macro2::Spacing::Alone));
            name.append(input.call(syn::Ident::parse_any)?);
        }
        let alias = if input.peek(Token![as]) {
            input.parse::<Token![as]>()?;
            input.parse()?
        } else {
            None
        };
        if alias.is_none() {
            if name.to_string() == "self" {
                abort!(
                    name,
                    "Can't use `self` as variable name. Try storing it in a temporary variable or \
                    rename it using `as`."
                );
            }
            if name.to_string().contains('.') {
                abort!(
                    name.span(),
                    "`{}`: Field accesses are not allowed as is, you must rename it!",
                    name
                );
            }
        }
        Ok(Capture {
            name,
            alias,
            kind,
            start,
        })
    }
}

struct Closure {
    captures: Vec<Capture>,
    args: Vec<Ident>,
    closure: syn::ExprClosure,
    constructor: &'static str,
}

impl syn::parse::Parse for Closure {
    fn parse(input: syn::parse::ParseStream) -> syn::Result<Self> {
        let mut captures: Vec<Capture> = vec![];
        if input.peek(Token![@]) {
            loop {
                let capture = input.parse::<Capture>()?;
                if capture.kind == CaptureKind::Watch {
                    if let Some(existing) = captures.iter().find(|c| c.kind == CaptureKind::Watch) {
                        abort!(
                            capture.start,
                            "Only one `@watch` capture is allowed per closure";
                            note = existing.start => "Previous `@watch` found here"
                        );
                    }
                }
                captures.push(capture);
                if input.peek(Token![,]) {
                    input.parse::<Token![,]>()?;
                    if !input.peek(Token![@]) {
                        break;
                    }
                } else {
                    break;
                }
            }
        }
        if !captures.is_empty() {
            input.parse::<Token![=>]>()?;
        }
        let mut closure = input.parse::<syn::ExprClosure>()?;
        if closure.asyncness.is_some() {
            abort!(closure, "Async closure not allowed");
        }
        if !captures.is_empty() && closure.capture.is_none() {
            abort!(
                closure,
                "Closure with captures needs to be \"moved\" so please add `move` before closure"
            )
        }
        let args = closure
            .inputs
            .iter()
            .enumerate()
            .map(|(i, _)| Ident::new(&format!("____value{i}"), Span::call_site()))
            .collect();
        closure.capture = None;
        Ok(Closure {
            captures,
            args,
            closure,
            constructor: "new",
        })
    }
}

impl ToTokens for Closure {
    fn to_tokens(&self, tokens: &mut TokenStream) {
        let closure_ident = Ident::new("____closure", Span::call_site());
        let values_ident = Ident::new("____values", Span::call_site());
        let crate_ident = crate_ident_new();

        let outer_before = self
            .captures
            .iter()
            .map(|c| c.outer_before_tokens(&crate_ident));
        let inner_before = self
            .captures
            .iter()
            .map(|c| c.inner_before_tokens(&crate_ident));
        let outer_after = self
            .captures
            .iter()
            .map(|c| c.outer_after_tokens(&crate_ident, &closure_ident));

        let arg_values = self.args.iter().enumerate().map(|(index, arg)| {
            let err_msg = format!("Wrong type for argument {index}: {{:?}}");
            quote! {
                let #arg = ::core::result::Result::unwrap_or_else(
                    #crate_ident::Value::get(&#values_ident[#index]),
                    |e| panic!(#err_msg, e),
                );
            }
        });
        let arg_names = &self.args;
        let args_len = self.args.len();
        let closure = &self.closure;
        let constructor = Ident::new(self.constructor, Span::call_site());

        tokens.extend(quote! {
            {
                let #closure_ident = {
                    #(#outer_before)*
                    #crate_ident::closure::RustClosure::#constructor(move |#values_ident| {
                        assert_eq!(
                            #values_ident.len(),
                            #args_len,
                            "Expected {} arguments but got {}",
                            #args_len,
                            #values_ident.len(),
                        );
                        #(#inner_before)*
                        #(#arg_values)*
                        #crate_ident::closure::IntoClosureReturnValue::into_closure_return_value(
                            (#closure)(#(#arg_names),*)
                        )
                    })
                };
                #(#outer_after)*
                #closure_ident
            }
        });
    }
}

pub(crate) fn closure_inner(
    input: proc_macro::TokenStream,
    constructor: &'static str,
) -> proc_macro::TokenStream {
    let mut closure = syn::parse_macro_input!(input as Closure);
    closure.constructor = constructor;
    closure.into_token_stream().into()
}
