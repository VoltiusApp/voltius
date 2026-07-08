// Take a look at the license at the top of the repository in the LICENSE file.

use proc_macro2::Span;
use syn::spanned::Spanned;
use syn::{
    parse::{Error, Parse, ParseStream},
    punctuated::Punctuated,
};
use syn::{Attribute, DeriveInput, Field, Fields, Ident, LitStr, Meta, Token, Type};

mod kw {
    syn::custom_keyword!(file);
    syn::custom_keyword!(resource);
    syn::custom_keyword!(string);

    syn::custom_keyword!(id);
}

pub enum TemplateSource {
    File(String),
    Resource(String),
    String(String),
}

impl Parse for TemplateSource {
    fn parse(input: ParseStream<'_>) -> syn::Result<Self> {
        let lookahead = input.lookahead1();
        let variant = if lookahead.peek(kw::file) {
            let _: kw::file = input.parse()?;
            TemplateSource::File
        } else if lookahead.peek(kw::resource) {
            let _: kw::resource = input.parse()?;
            TemplateSource::Resource
        } else if lookahead.peek(kw::string) {
            let _: kw::string = input.parse()?;
            TemplateSource::String
        } else {
            return Err(lookahead.error());
        };

        let _: Token![=] = input.parse()?;
        let lit: LitStr = input.parse()?;
        Ok(variant(lit.value()))
    }
}

#[derive(Debug)]
pub enum ParseTemplateSourceError {
    MissingAttribute,
    Parse(syn::Error),
}

impl std::fmt::Display for ParseTemplateSourceError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::MissingAttribute => write!(f, "Missing 'template' attribute"),
            Self::Parse(err) => write!(f, "{}", err),
        }
    }
}

impl std::error::Error for ParseTemplateSourceError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::MissingAttribute => None,
            Self::Parse(err) => Some(err),
        }
    }
}

pub fn parse_template_source(
    input: &DeriveInput,
) -> Result<TemplateSource, ParseTemplateSourceError> {
    input
        .attrs
        .iter()
        .find(|a| a.path().is_ident("template"))
        .ok_or(ParseTemplateSourceError::MissingAttribute)?
        .parse_args()
        .map_err(ParseTemplateSourceError::Parse)
}

pub enum FieldAttributeArg {
    Id(String),
}

impl Parse for FieldAttributeArg {
    fn parse(input: ParseStream<'_>) -> syn::Result<Self> {
        let lookahead = input.lookahead1();
        if lookahead.peek(kw::id) {
            let _: kw::id = input.parse()?;
            let _: Token![=] = input.parse()?;
            let lit: LitStr = input.parse()?;
            Ok(Self::Id(lit.value()))
        } else {
            Err(lookahead.error())
        }
    }
}

#[derive(Debug)]
pub enum FieldAttributeType {
    TemplateChild,
}

pub struct FieldAttribute {
    pub ty: FieldAttributeType,
    pub args: Vec<FieldAttributeArg>,
    pub path_span: Span,
    pub span: Span,
}

pub struct AttributedField {
    pub ident: Ident,
    pub ty: Type,
    pub attr: FieldAttribute,
}

fn parse_field_attr_args(attr: &Attribute) -> Result<Vec<FieldAttributeArg>, Error> {
    let mut field_attribute_args = Vec::new();
    match &attr.meta {
        Meta::List(list) => {
            let args =
                list.parse_args_with(Punctuated::<FieldAttributeArg, Token![,]>::parse_terminated)?;
            for arg in args {
                for prev_arg in &field_attribute_args {
                    // Comparison of enum variants, not data
                    if std::mem::discriminant(prev_arg) == std::mem::discriminant(&arg) {
                        return Err(Error::new(
                            attr.span(),
                            "two instances of the same attribute \
                            argument, each argument must be specified only once",
                        ));
                    }
                }
                field_attribute_args.push(arg);
            }
        }
        Meta::Path(_) => (),
        meta => {
            return Err(Error::new(
                meta.span(),
                "invalid attribute argument type, expected `name = value` list or nothing",
            ))
        }
    }

    Ok(field_attribute_args)
}

fn parse_field(field: &Field) -> Result<Option<AttributedField>, Error> {
    let field_attrs = &field.attrs;
    let ident = match &field.ident {
        Some(ident) => ident,
        None => return Err(Error::new(field.span(), "expected identifier")),
    };

    let ty = &field.ty;
    let mut attr = None;

    for field_attr in field_attrs {
        let span = field_attr.span();
        let path_span = field_attr.path().span();
        let ty = if field_attr.path().is_ident("template_child") {
            Some(FieldAttributeType::TemplateChild)
        } else {
            None
        };

        if let Some(ty) = ty {
            let args = parse_field_attr_args(field_attr)?;

            if attr.is_none() {
                attr = Some(FieldAttribute {
                    ty,
                    args,
                    path_span,
                    span,
                })
            } else {
                return Err(Error::new(
                    span,
                    "multiple attributes on the same field are not supported",
                ));
            }
        }
    }

    if let Some(attr) = attr {
        Ok(Some(AttributedField {
            ident: ident.clone(),
            ty: ty.clone(),
            attr,
        }))
    } else {
        Ok(None)
    }
}

pub fn parse_fields(fields: &Fields) -> Result<Vec<AttributedField>, Error> {
    let mut attributed_fields = Vec::new();

    for field in fields {
        if !field.attrs.is_empty() {
            if let Some(attributed_field) = parse_field(field)? {
                attributed_fields.push(attributed_field)
            }
        }
    }

    Ok(attributed_fields)
}
