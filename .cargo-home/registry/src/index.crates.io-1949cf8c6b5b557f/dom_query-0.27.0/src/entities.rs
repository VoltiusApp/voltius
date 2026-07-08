#[cfg(feature = "hashbrown")]
mod hash {
    use hashbrown::HashMap;
    pub type InnerHashMap<K, V> = HashMap<K, V>;
}

#[cfg(not(feature = "hashbrown"))]
mod hash {
    use foldhash::HashMap;
    pub type InnerHashMap<K, V> = HashMap<K, V>;
}

pub(crate) use hash::InnerHashMap;

#[cfg(feature = "atomic")]
mod str_wrap {
    use html5ever::{Attribute, QualName};
    use tendril::Tendril;

    /// An alias of [`Tendril<tendril::fmt::UTF8, tendril::Atomic>`].
    pub type StrWrap = Tendril<tendril::fmt::UTF8, tendril::Atomic>;

    /// A tag attribute, e.g. `class="test"` in `<div class="test" ...>`.
    ///
    /// The namespace on the attribute name is almost always ns!("").
    /// The tokenizer creates all attributes this way, but the tree
    /// builder will adjust certain attribute names inside foreign
    /// content (MathML, SVG).
    #[derive(PartialEq, Eq, PartialOrd, Ord, Clone, Debug)]
    pub struct Attr {
        /// The name of the attribute (e.g. the `class` in `<div class="test">`)
        pub name: QualName,
        /// The value of the attribute (e.g. the `"test"` in `<div class="test">`)
        pub value: StrWrap,
    }

    #[inline]
    pub fn wrap_tendril(v: tendril::StrTendril) -> StrWrap {
        v.into_send().into()
    }

    #[inline]
    pub fn into_tendril(v: StrWrap) -> tendril::StrTendril {
        v.into_send().into()
    }

    pub fn wrap_attrs(v: Vec<Attribute>) -> Vec<Attr> {
        v.into_iter()
            .map(|a| Attr {
                name: a.name,
                value: wrap_tendril(a.value),
            })
            .collect()
    }

    pub fn copy_attrs(v: &[Attr]) -> Vec<Attribute> {
        v.iter()
            .map(|a| Attribute {
                name: a.name.clone(),
                value: into_tendril(a.value.clone()),
            })
            .collect()
    }
}

#[cfg(not(feature = "atomic"))]
mod str_wrap {
    use html5ever::Attribute;
    use tendril::StrTendril;

    /// An alias of [`tendril::StrTendril`]
    pub type StrWrap = StrTendril;
    /// An alias of [`html5ever::Attribute`]
    pub type Attr = Attribute;

    #[inline]
    pub fn wrap_tendril(v: tendril::StrTendril) -> StrWrap {
        v
    }

    #[inline]
    pub fn into_tendril(v: StrWrap) -> tendril::StrTendril {
        v
    }

    #[inline]
    pub fn wrap_attrs(v: Vec<Attribute>) -> Vec<Attr> {
        v
    }

    #[inline]
    pub fn copy_attrs(v: &[Attr]) -> Vec<Attribute> {
        v.to_vec()
    }
}

pub use str_wrap::Attr;
pub(crate) use str_wrap::StrWrap;
pub(crate) use str_wrap::{copy_attrs, into_tendril, wrap_attrs, wrap_tendril};
