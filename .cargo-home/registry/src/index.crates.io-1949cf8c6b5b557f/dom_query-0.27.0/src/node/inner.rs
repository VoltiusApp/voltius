use std::fmt::Debug;

use super::node_data::{Element, NodeData};
use crate::NodeId;

/// The inner node is a [`crate::Tree`] node.
#[derive(Debug, Clone)]
pub struct TreeNode {
    pub id: NodeId,
    pub parent: Option<NodeId>,
    pub prev_sibling: Option<NodeId>,
    pub next_sibling: Option<NodeId>,
    pub first_child: Option<NodeId>,
    pub last_child: Option<NodeId>,
    pub data: NodeData,
}

impl TreeNode {
    /// Creates a new inner node.
    pub(crate) fn new(id: NodeId, data: NodeData) -> Self {
        TreeNode {
            id,
            parent: None,
            prev_sibling: None,
            next_sibling: None,
            first_child: None,
            last_child: None,
            data,
        }
    }
}

impl TreeNode {
    /// fixes node ids
    pub(crate) fn adjust(&mut self, offset: usize) {
        self.id = NodeId::new(self.id.value + offset);

        let adjust_fn = |id: NodeId| NodeId::new(id.value + offset);
        self.parent = self.parent.map(adjust_fn);
        self.prev_sibling = self.prev_sibling.map(adjust_fn);
        self.next_sibling = self.next_sibling.map(adjust_fn);
        self.first_child = self.first_child.map(adjust_fn);
        self.last_child = self.last_child.map(adjust_fn);

        if let NodeData::Element(ref mut el) = self.data {
            el.template_contents = el.template_contents.map(adjust_fn);
        }
    }
}

impl TreeNode {
    /// Checks if the node is a document node.
    pub fn is_document(&self) -> bool {
        matches!(self.data, NodeData::Document)
    }

    /// Checks if the node is an element node.
    pub fn is_element(&self) -> bool {
        matches!(self.data, NodeData::Element(_))
    }

    /// Checks if the node is a text node.
    pub fn is_text(&self) -> bool {
        matches!(self.data, NodeData::Text { .. })
    }

    /// Checks if the node is a comment node.
    pub fn is_comment(&self) -> bool {
        matches!(self.data, NodeData::Comment { .. })
    }

    /// Checks if the node is a fragment node.
    pub fn is_fragment(&self) -> bool {
        matches!(self.data, NodeData::Fragment)
    }

    /// Checks if the node is a doctype node.
    pub fn is_doctype(&self) -> bool {
        matches!(self.data, NodeData::Doctype { .. })
    }

    /// Checks if node may have children nodes.
    pub fn may_have_children(&self) -> bool {
        matches!(
            self.data,
            NodeData::Document | NodeData::Fragment | NodeData::Element(_)
        )
    }

    /// Returns a reference to the node as an element. If the node is not an element, `None` is returned.
    ///
    /// # Returns
    /// `Option<&Element>`
    pub fn as_element(&self) -> Option<&Element> {
        match self.data {
            NodeData::Element(ref e) => Some(e),
            _ => None,
        }
    }

    /// Returns a mutable reference to the node as an element. If the node is not an element, `None` is returned.
    pub fn as_element_mut(&mut self) -> Option<&mut Element> {
        match self.data {
            NodeData::Element(ref mut e) => Some(e),
            _ => None,
        }
    }

    /// Sets the value of the specified attribute to the node.
    pub fn set_attr(&mut self, name: &str, val: &str) {
        if let Some(element) = self.as_element_mut() {
            element.set_attr(name, val);
        }
    }

    /// Removes the specified attribute from the element.
    pub fn remove_attr(&mut self, name: &str) {
        if let Some(element) = self.as_element_mut() {
            element.remove_attr(name);
        }
    }

    /// Removes the specified attributes from the element.
    ///
    /// # Arguments
    /// - `names`: A slice of attribute names to remove. Empty slice removes no attributes.
    pub fn remove_attrs(&mut self, names: &[&str]) {
        if let Some(element) = self.as_element_mut() {
            element.remove_attrs(names);
        }
    }

    /// Retains only the attributes with the specified names.
    ///
    /// # Arguments
    /// - `names`: A slice of attribute names to retain. Empty slice retains no attributes.
    pub fn retain_attrs(&mut self, names: &[&str]) {
        if let Some(element) = self.as_element_mut() {
            element.retain_attrs(names);
        }
    }

    /// Removes all attributes from the element.
    pub fn remove_all_attrs(&mut self) {
        if let Some(element) = self.as_element_mut() {
            element.remove_all_attrs();
        }
    }

    /// Renames the node if node is an [`NodeData::Element`].
    pub fn rename(&mut self, name: &str) {
        if let Some(element) = self.as_element_mut() {
            element.rename(name);
        }
    }

    /// Adds a class to the node
    pub fn add_class(&mut self, class: &str) {
        if let Some(element) = self.as_element_mut() {
            element.add_class(class);
        }
    }

    /// Removes a class from the node
    pub fn remove_class(&mut self, class: &str) {
        if let Some(element) = self.as_element_mut() {
            element.remove_class(class);
        }
    }

    /// If element is link.
    pub fn is_link(&self) -> bool {
        if let Some(element) = self.as_element() {
            element.is_link()
        } else {
            false
        }
    }
}
