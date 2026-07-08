use syn::{Attribute, Data, DeriveInput, Expr, ExprLit, Field, Fields, FieldsNamed, Lit, Meta};

pub fn symbol_name(field: &Field) -> String {
    match find_str_attr_val(field, "dlopen2_name") {
        Some(val) => val,
        None => {
            // not found, so use field name
            match field.ident {
                Some(ref val) => val.to_string(),
                None => panic!("All structure fields need to be identifiable"),
            }
        }
    }
}

pub fn find_str_attr_val(field: &Field, attr_name: &str) -> Option<String> {
    for attr in field.attrs.iter() {
        match attr.meta {
            Meta::NameValue(ref meta) => {
                if let Some(ident) = meta.path.get_ident() {
                    if ident == attr_name {
                        return match &meta.value {
                            Expr::Lit(ExprLit {
                                lit: Lit::Str(val), ..
                            }) => Some(val.value()),
                            _ => panic!("{attr_name} attribute must be a string"),
                        };
                    }
                }
            }
            _ => continue,
        }
    }
    None
}

pub fn get_non_marker_attrs(field: &Field) -> Vec<&Attribute> {
    field
        .attrs
        .iter()
        .filter(|attr| {
            if let Some(ident) = attr.path().get_ident() {
                if ident.to_string().starts_with("dlopen2_") {
                    return false;
                }
            }
            true
        })
        .collect::<Vec<_>>()
}

pub fn has_marker_attr(field: &Field, attr_name: &str) -> bool {
    for attr in field.attrs.iter() {
        match attr.meta {
            Meta::Path(ref val) => {
                if let Some(ident) = val.get_ident() {
                    return ident == attr_name;
                }
            }
            _ => continue,
        }
    }
    false
}

pub fn get_fields<'a>(ast: &'a DeriveInput, trait_name: &str) -> &'a FieldsNamed {
    let vd = match ast.data {
        Data::Enum(_) | Data::Union(_) => {
            panic!("{trait_name} can be only implemented for structures")
        }
        Data::Struct(ref val) => val,
    };
    match vd.fields {
        Fields::Named(ref f) => f,
        Fields::Unnamed(_) | Fields::Unit => {
            panic!("{trait_name} can be only implemented for structures")
        }
    }
}
