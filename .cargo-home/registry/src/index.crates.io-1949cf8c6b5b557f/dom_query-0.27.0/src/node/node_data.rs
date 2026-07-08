use std::fmt::Debug;

#[allow(unused_imports)]
use html5ever::namespace_url;
use html5ever::LocalName;
use html5ever::{local_name, ns, Attribute, QualName};
use selectors::attr::CaseSensitivity;
use tendril::StrTendril;

use super::NodeId;
use crate::entities::{into_tendril, wrap_attrs, wrap_tendril, Attr, StrWrap};

fn contains_class(classes: &str, target_class: &str) -> bool {
    classes.split_ascii_whitespace().any(|c| c == target_class)
}

#[inline]
fn dedup_classes<'a>(source: &'a str, mut existing: Vec<&'a str>) -> StrTendril {
    for cls in source.split_ascii_whitespace() {
        if !existing.contains(&cls) {
            existing.push(cls);
        }
    }
    StrTendril::from(existing.join(" "))
}

/// The different kinds of nodes in the DOM.
#[derive(Debug, Clone)]
pub enum NodeData {
    /// The `Tree` itself - the root node of a HTML tree.
    Document,

    /// A root of the html fragment
    Fragment,

    /// A `DOCTYPE` with name, public id, and system id. See
    /// [tree type declaration on wikipedia][dtd wiki].
    ///
    /// [dtd wiki]: https://en.wikipedia.org/wiki/Tree_type_declaration
    Doctype {
        name: StrWrap,
        public_id: StrWrap,
        system_id: StrWrap,
    },

    /// A text node.
    Text { contents: StrWrap },

    /// A comment.
    Comment { contents: StrWrap },

    /// An element with attributes.
    Element(Element),

    /// A Processing instruction.
    ProcessingInstruction { target: StrWrap, contents: StrWrap },
}

/// An element with attributes.
#[derive(Debug, Clone)]
pub struct Element {
    pub name: QualName,
    pub attrs: Vec<Attr>,

    /// For HTML \<template\> elements, the [template contents].
    ///
    /// [template contents]: https://html.spec.whatwg.org/multipage/#template-contents
    pub template_contents: Option<NodeId>,

    /// Whether the element is a MathML `annotation-xml` integration point.
    ///
    /// This is set by the parser when an `annotation-xml` element in the MathML
    /// namespace has an `encoding` of `text/html` or `application/xhtml+xml`
    /// (ASCII case-insensitive), making it an integration point for HTML.
    /// See the HTML parsing spec for "MathML annotation-xml integration points".
    pub mathml_annotation_xml_integration_point: bool,
}

impl Element {
    /// Create a new element.
    pub fn new(
        name: QualName,
        attrs: Vec<Attribute>,
        template_contents: Option<NodeId>,
        mathml_annotation_xml_integration_point: bool,
    ) -> Element {
        Element {
            name,
            attrs: wrap_attrs(attrs),
            template_contents,
            mathml_annotation_xml_integration_point,
        }
    }

    /// The name of the node.
    pub fn node_name(&self) -> StrTendril {
        StrTendril::from(self.name.local.as_ref())
    }

    /// Get the class attribute of the node.
    pub fn class(&self) -> Option<StrTendril> {
        self.attrs
            .iter()
            .find(|a| a.name.local == local_name!("class"))
            .map(|a| into_tendril(a.value.clone()))
    }

    /// Get the id attribute of the node.
    pub fn id(&self) -> Option<StrTendril> {
        self.attrs
            .iter()
            .find(|a| a.name.local == local_name!("id"))
            .map(|a| into_tendril(a.value.clone()))
    }

    /// Whether the element has the given class.
    pub fn has_class(&self, class: &str) -> bool {
        self.attr_ref(local_name!("class"))
            .is_some_and(|class_val| contains_class(class_val, class))
    }

    /// Whether the element has the given class.
    pub fn has_class_bytes(&self, name: &[u8], case_sensitivity: CaseSensitivity) -> bool {
        self.attr_ref(local_name!("class"))
            .is_some_and(|class_val| {
                class_val
                    .split_ascii_whitespace()
                    .any(|c| case_sensitivity.eq(name, c.as_bytes()))
            })
    }

    /// Add a class to the element.
    pub fn add_class(&mut self, classes: &str) {
        if classes.trim().is_empty() {
            return;
        }

        let attr = self
            .attrs
            .iter_mut()
            .find(|attr| attr.name.local == local_name!("class"));

        match attr {
            Some(attr) => {
                let existing: Vec<&str> = attr.value.split_ascii_whitespace().collect();
                let value = dedup_classes(classes, existing);
                attr.value = wrap_tendril(value)
            }
            None => {
                let value = dedup_classes(classes, Vec::new());
                // The namespace on the attribute name is almost always ns!().
                let name = QualName::new(None, ns!(), local_name!("class"));
                self.attrs.push(Attr {
                    name,
                    value: wrap_tendril(value),
                });
            }
        }
    }

    /// Remove a class from the element.
    pub fn remove_class(&mut self, class: &str) {
        if class.trim().is_empty() {
            return;
        }

        if let Some(attr) = self
            .attrs
            .iter_mut()
            .find(|attr| attr.name.local == local_name!("class"))
        {
            let excluding: Vec<&str> = class.split_ascii_whitespace().collect();
            let mut existing: Vec<&str> = attr.value.split_ascii_whitespace().collect();
            existing.retain(|x| !excluding.contains(x));
            attr.value = wrap_tendril(StrTendril::from(existing.join(" ")));
        }
    }

    /// Gets the specified attribute's value.
    pub fn attr(&self, name: &str) -> Option<StrTendril> {
        self.attrs
            .iter()
            .find(|attr| &attr.name.local == name)
            .map(|attr| into_tendril(attr.value.clone()))
    }

    /// Sets the specified attribute's value.
    pub fn set_attr(&mut self, name: &str, val: &str) {
        let attr = self.attrs.iter_mut().find(|a| &a.name.local == name);
        match attr {
            Some(attr) => attr.value = wrap_tendril(StrTendril::from(val)),
            None => {
                let value = StrTendril::from(val);
                // The namespace on the attribute name is almost always ns!().
                let name = QualName::new(None, ns!(), LocalName::from(name));
                self.attrs.push(Attr {
                    name,
                    value: wrap_tendril(value),
                })
            }
        }
    }

    /// Removes the specified attribute from the element.
    pub fn remove_attr(&mut self, name: &str) {
        self.attrs.retain(|attr| &attr.name.local != name);
    }

    /// Removes the specified attributes from the element.
    ///
    /// # Arguments
    /// - `names`: A slice of attribute names to remove. Empty slice removes no attributes.
    pub fn remove_attrs(&mut self, names: &[&str]) {
        self.attrs
            .retain(|attr| !names.contains(&attr.name.local.as_ref()));
    }

    /// Retains only the attributes with the specified names.
    ///
    /// # Arguments
    /// - `names`: A slice of attribute names to retain. Empty slice retains no attributes.
    pub fn retain_attrs(&mut self, names: &[&str]) {
        self.attrs
            .retain(|a| names.contains(&a.name.local.as_ref()));
    }

    /// Removes all attributes from the element.
    pub fn remove_all_attrs(&mut self) {
        self.attrs.clear();
    }

    /// Checks if the element has an attribute with the name.
    pub fn has_attr(&self, name: &str) -> bool {
        self.attrs.iter().any(|attr| &attr.name.local == name)
    }

    /// Retrieves the value of an attribute by the given [LocalName].
    pub fn attr_ref(&self, local_name: LocalName) -> Option<&str> {
        self.attrs
            .iter()
            .find(|a| a.name.local == local_name)
            .map(|a| a.value.as_ref())
    }

    /// Add attributes if they are not already present.
    pub(crate) fn add_attrs_if_missing(&mut self, attrs: Vec<Attribute>) {
        let attrs = wrap_attrs(attrs);
        let existing_names = self
            .attrs
            .iter()
            .map(|e| e.name.clone())
            .collect::<Vec<_>>();

        self.attrs.extend(
            attrs
                .into_iter()
                .filter(|attr| !existing_names.contains(&attr.name)),
        );
    }

    /// Renames the element.
    pub fn rename(&mut self, name: &str) {
        let new_name = QualName::new(None, ns!(), LocalName::from(name));
        self.name = new_name;
    }

    /// If element is a link.
    pub fn is_link(&self) -> bool {
        matches!(
            self.name.local,
            local_name!("a") | local_name!("area") | local_name!("link")
        ) && self
            .attrs
            .iter()
            .any(|a| a.name.local == local_name!("href"))
    }
}
