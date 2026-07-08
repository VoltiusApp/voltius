use html5ever::local_name;

use crate::{node::TreeNode, Element, NodeRef};

use super::parser::parse_mini_selector;

static SELECTOR_WHITESPACE: &[char] = &[' ', '\t', '\n', '\r', '\x0C'];

#[derive(Debug, PartialEq)]
pub(crate) enum AttrOperator {
    Equals,    // =
    Includes,  // ~=
    DashMatch, // |=
    Prefix,    // ^=
    Suffix,    // $=
    Substring, // *=
}

#[derive(Debug, PartialEq)]
pub(crate) enum Combinator {
    Descendant,
    Child,
    Adjacent,
    Sibling,
}

#[derive(Debug, PartialEq)]
pub(crate) struct AttrValue<'a> {
    pub op: AttrOperator,
    pub value: &'a str,
}

impl AttrValue<'_> {
    pub(crate) fn is_match(&self, elem_value: &str) -> bool {
        if elem_value.is_empty() {
            return false;
        }
        let e = elem_value.as_bytes();
        let s = self.value.as_bytes();

        match self.op {
            AttrOperator::Equals => e == s,
            AttrOperator::Includes => elem_value
                .split(SELECTOR_WHITESPACE)
                .any(|part| part.as_bytes() == s),
            AttrOperator::DashMatch => {
                e == s
                    || (e.starts_with(s) && e.len() > s.len() && &e[s.len()..s.len() + 1] == b"-")
            }
            AttrOperator::Prefix => e.starts_with(s),
            AttrOperator::Suffix => e.ends_with(s),
            AttrOperator::Substring => elem_value.contains(self.value),
        }
    }
}

#[derive(Debug, PartialEq)]
pub(crate) struct Attribute<'a> {
    pub key: &'a str,
    pub value: Option<AttrValue<'a>>,
}

/// Current support of CSS is limited: it supports only the `child` (`>`) and `descendant` (` `) combinators.
/// It does not support the `selector list` combinator (`,`) or any pseudo-classes.
#[derive(Debug, PartialEq)]
pub struct MiniSelector<'a> {
    pub(crate) name: Option<&'a str>,
    pub(crate) id: Option<&'a str>,
    pub(crate) classes: Option<Vec<&'a str>>,
    pub(crate) attrs: Option<Vec<Attribute<'a>>>,
    pub(crate) combinator: Combinator,
}

impl<'a> MiniSelector<'a> {
    /// Parses a single CSS selector string and returns a `MiniSelector` representing the parsed selector.
    ///
    /// # Arguments
    ///
    /// * `css_sel` - The CSS selector string to parse.
    ///
    /// # Returns
    ///
    /// A `Result` containing the parsed `MiniSelector` if the CSS selector string is valid, or an [nom::Err] if it is not.
    pub fn new(css_sel: &'a str) -> Result<Self, nom::Err<nom::error::Error<&'a str>>> {
        let (_, sel) = parse_mini_selector(css_sel)?;
        Ok(sel)
    }
}

impl MiniSelector<'_> {
    pub(crate) fn match_tree_node(&self, t: &TreeNode) -> bool {
        if let Some(el) = t.as_element() {
            self.match_name(el)
                && self.match_id_attr(el)
                && self.match_classes(el)
                && self.match_attrs(el)
        } else {
            false
        }
    }

    /// Checks if a `NodeRef` matches the `MiniSelector`.
    ///
    /// # Arguments
    ///
    /// * `node_ref` - The `NodeRef` to check.
    ///
    /// # Returns
    ///
    /// `true` if `node_ref` matches the `MiniSelector`, `false` otherwise.
    pub fn match_node(&self, node_ref: &NodeRef) -> bool {
        let nodes = node_ref.tree.nodes.borrow();
        let tree_node = &nodes[node_ref.id.value];
        self.match_tree_node(tree_node)
    }

    fn match_name(&self, el: &Element) -> bool {
        self.name.map_or(true, |name| &el.name.local == name)
    }

    fn match_id_attr(&self, el: &Element) -> bool {
        let Some(id) = self.id else {
            return true;
        };
        el.attr_ref(local_name!("id")).is_some_and(|v| v == id)
    }

    fn match_classes(&self, el: &Element) -> bool {
        let Some(ref classes) = self.classes else {
            return true;
        };
        let Some(class_val) = el.attr_ref(local_name!("class")) else {
            return false;
        };
        classes
            .iter()
            .all(|class| class_val.split_ascii_whitespace().any(|c| c == *class))
    }

    fn match_attrs(&self, el: &Element) -> bool {
        let Some(ref attrs) = self.attrs else {
            return true;
        };
        let mut is_ok = true;
        for attr in attrs {
            let key = attr.key;
            is_ok = match &attr.value {
                Some(attr_value) => el
                    .attrs
                    .iter()
                    .any(|a| &a.name.local == key && attr_value.is_match(&a.value)),
                _ => el.has_attr(key),
            };
            if !is_ok {
                break;
            }
        }
        is_ok
    }
}
