use std::cell::Ref;
use std::fmt::Debug;
use std::ops::Deref;
use std::ops::DerefMut;

use html5ever::serialize;
use html5ever::serialize::SerializeOpts;
use html5ever::serialize::TraversalScope;
use html5ever::Attribute;

use html5ever::QualName;
use tendril::StrTendril;

use crate::dom_tree::Traversal;
use crate::entities::copy_attrs;
use crate::Document;
use crate::Matcher;
use crate::Tree;
use crate::TreeNodeOps;

use super::id_provider::NodeIdProver;
use super::inner::TreeNode;
use super::node_data::NodeData;
use super::serializing::SerializableNodeRef;
use super::text_formatting::format_text;
use super::Element;
use super::NodeId;
use super::{child_nodes, descendant_nodes};

pub type Node<'a> = NodeRef<'a>;

#[derive(Clone, Copy, Debug)]
/// Represents a reference to a node in the tree.
/// It keeps a node id and a reference to the tree,
/// which allows to access to the actual tree node with [NodeData].
pub struct NodeRef<'a> {
    pub id: NodeId,
    pub tree: &'a Tree,
}

impl<'a> NodeRef<'a> {
    /// Creates a new node reference.
    pub fn new(id: NodeId, tree: &'a Tree) -> Self {
        Self { id, tree }
    }

    /// Selects the node from the tree and applies a function to it.
    #[inline]
    pub fn query<F, B>(&self, f: F) -> Option<B>
    where
        F: FnOnce(&TreeNode) -> B,
    {
        self.tree.query_node(&self.id, f)
    }

    /// Selects the node from the tree and applies a function to it.
    /// Accepts a default value to return for a case if the node doesn't exist.
    #[inline]
    pub fn query_or<F, B>(&self, default: B, f: F) -> B
    where
        F: FnOnce(&TreeNode) -> B,
    {
        self.tree.query_node_or(&self.id, default, f)
    }

    /// Selects the node from the tree and applies a function to it.
    #[inline]
    pub fn update<F, B>(&self, f: F) -> Option<B>
    where
        F: FnOnce(&mut TreeNode) -> B,
    {
        self.tree.update_node(&self.id, f)
    }

    /// Returns the parent node of the selected node.
    #[inline]
    pub fn parent(&self) -> Option<Self> {
        self.tree.parent_of(&self.id)
    }

    /// Returns the child nodes of the selected node.
    #[inline]
    pub fn children(&self) -> Vec<Self> {
        self.tree.children_of(&self.id)
    }

    /// Returns the iterator child nodes of the selected node.
    #[inline]
    pub fn children_it(&self, rev: bool) -> impl Iterator<Item = Self> {
        self.tree
            .child_ids_of_it(&self.id, rev)
            .map(|n| NodeRef::new(n, self.tree))
    }

    /// Returns ancestor nodes of the selected node.
    ///
    /// # Arguments
    /// * `max_depth` - The maximum depth of the ancestors. If `None`, or Some(0) the maximum depth is unlimited.
    ///
    /// # Returns
    ///
    /// `Vec<Self>`
    #[inline]
    pub fn ancestors(&self, max_depth: Option<usize>) -> Vec<Self> {
        self.tree.ancestors_of(&self.id, max_depth)
    }

    /// Returns the iterator ancestor nodes of the selected node.
    ///
    /// # Arguments
    /// * `max_depth` - The maximum depth of the ancestors. If `None`, or Some(0) the maximum depth is unlimited.
    ///
    /// # Returns
    /// impl Iterator<Item = Self>
    #[inline]
    pub fn ancestors_it(&self, max_depth: Option<usize>) -> impl Iterator<Item = Self> {
        self.tree
            .ancestor_ids_of_it(&self.id, max_depth)
            .map(|n| NodeRef::new(n, self.tree))
    }

    /// Returns the descendant nodes of the selected node.
    ///
    /// # Returns
    /// `Vec<NodeRef>` -- a vector of descendant nodes
    #[inline]
    pub fn descendants(&self) -> Vec<Self> {
        self.descendants_it().collect()
    }

    /// Returns an iterator of the descendant nodes of the selected node.
    ///
    /// # Returns
    /// impl Iterator<Item = Self> -- an iterator of descendant nodes
    #[inline]
    pub fn descendants_it(&self) -> impl Iterator<Item = Self> {
        self.tree
            .descendant_ids_of_it(&self.id)
            .map(|n| NodeRef::new(n, self.tree))
    }

    /// Returns the first child node of the selected node.
    #[inline]
    pub fn first_child(&self) -> Option<Self> {
        self.tree.first_child_of(&self.id)
    }

    /// Returns the last child node of the selected node.
    #[inline]
    pub fn last_child(&self) -> Option<Self> {
        self.tree.last_child_of(&self.id)
    }

    /// Returns the next sibling node of the selected node.
    #[inline]
    pub fn next_sibling(&self) -> Option<Self> {
        self.tree.next_sibling_of(&self.id)
    }

    /// Returns the previous sibling node of the selected node.
    #[inline]
    pub fn prev_sibling(&self) -> Option<Self> {
        self.tree.prev_sibling_of(&self.id)
    }

    /// Returns the last sibling node of the selected node.
    #[inline]
    pub fn last_sibling(&self) -> Option<Self> {
        self.tree.last_sibling_of(&self.id)
    }
}

// NodeRef modification methods
impl NodeRef<'_> {
    /// Removes the selected node from its parent node, but keeps it in the tree.
    #[inline]
    pub fn remove_from_parent(&self) {
        self.tree.remove_from_parent(&self.id)
    }

    /// Removes all children nodes of the selected node.
    #[inline]
    pub fn remove_children(&self) {
        self.tree.remove_children_of(&self.id)
    }

    /// Inserts another node by id before the selected node.
    /// Another node takes place of the selected node shifting it to right.
    #[inline]
    pub fn insert_before<P: NodeIdProver>(&self, id_provider: P) {
        self.tree.insert_before_of(&self.id, id_provider.node_id())
    }

    /// Inserts another node by id after the selected node.
    /// Another node takes place of the next sibling of the selected node.
    pub fn insert_after<P: NodeIdProver>(&self, id_provider: P) {
        self.tree.insert_after_of(&self.id, id_provider.node_id())
    }

    /// Appends another node by id to the selected node.
    #[inline]
    pub fn append_child<P: NodeIdProver>(&self, id_provider: P) {
        let new_child_id = id_provider.node_id();
        let mut nodes = self.tree.nodes.borrow_mut();
        TreeNodeOps::append_child_of(nodes.deref_mut(), &self.id, new_child_id);
    }

    /// Appends another node and it's siblings to the selected node.
    #[inline]
    pub fn append_children<P: NodeIdProver>(&self, id_provider: P) {
        let mut nodes = self.tree.nodes.borrow_mut();
        TreeNodeOps::append_children_of(&mut nodes, &self.id, id_provider.node_id());
    }

    /// Prepend another node by id to the selected node.
    #[inline]
    pub fn prepend_child<P: NodeIdProver>(&self, id_provider: P) {
        let new_child_id = id_provider.node_id();
        let mut nodes = self.tree.nodes.borrow_mut();
        TreeNodeOps::remove_from_parent(nodes.deref_mut(), new_child_id);
        TreeNodeOps::prepend_child_of(nodes.deref_mut(), &self.id, new_child_id);
    }

    /// Prepend another node and it's siblings to the selected node.
    pub fn prepend_children<P: NodeIdProver>(&self, id_provider: P) {
        // avoiding call borrow
        let new_child_id = id_provider.node_id();
        let mut nodes = self.tree.nodes.borrow_mut();
        TreeNodeOps::prepend_children_of(&mut nodes, &self.id, new_child_id);
    }

    /// Inserts another node and it's siblings before the current node
    /// shifting itself.
    #[inline]
    pub fn insert_siblings_before<P: NodeIdProver>(&self, id_provider: P) {
        let mut nodes = self.tree.nodes.borrow_mut();
        TreeNodeOps::insert_siblings_before(nodes.deref_mut(), &self.id, id_provider.node_id());
    }

    /// Inserts another node and it's siblings after the current node.
    #[inline]
    pub fn insert_siblings_after<P: NodeIdProver>(&self, id_provider: P) {
        let mut nodes = self.tree.nodes.borrow_mut();
        TreeNodeOps::insert_siblings_after(nodes.deref_mut(), &self.id, id_provider.node_id());
    }

    /// Replaces the current node with other node by id. It'is actually a shortcut of two operations:
    /// [`NodeRef::insert_before`] and [`NodeRef::remove_from_parent`].
    pub fn replace_with<P: NodeIdProver>(&self, id_provider: P) {
        let mut nodes = self.tree.nodes.borrow_mut();
        TreeNodeOps::insert_before_of(nodes.deref_mut(), &self.id, id_provider.node_id());
        TreeNodeOps::remove_from_parent(&mut nodes, &self.id);
    }

    /// Replaces the current node with other node, created from the given fragment html.
    /// Behaves similarly to [`crate::Selection::replace_with_html`] but only for one node.
    pub fn replace_with_html<T>(&self, html: T)
    where
        T: Into<StrTendril>,
    {
        self.merge_html_with_fn(html, |tree_nodes, new_node_id, node| {
            TreeNodeOps::insert_siblings_before(tree_nodes, &node.id, &new_node_id);
            TreeNodeOps::remove_from_parent(tree_nodes, &node.id);
        });
    }

    /// Parses given fragment html and appends its contents to the selected node.
    pub fn append_html<T>(&self, html: T)
    where
        T: Into<StrTendril>,
    {
        self.merge_html_with_fn(html, |tree_nodes, new_node_id, node| {
            TreeNodeOps::append_children_of(tree_nodes, &node.id, &new_node_id);
        });
    }

    /// Parses given fragment html and appends its contents to the selected node.
    pub fn prepend_html<T>(&self, html: T)
    where
        T: Into<StrTendril>,
    {
        self.merge_html_with_fn(html, |tree_nodes, new_node_id, node| {
            TreeNodeOps::prepend_children_of(tree_nodes, &node.id, &new_node_id);
        });
    }

    /// Parses given fragment html inserts its contents before to the selected node.
    pub fn before_html<T>(&self, html: T)
    where
        T: Into<StrTendril>,
    {
        self.merge_html_with_fn(html, |tree_nodes, new_node_id, node| {
            TreeNodeOps::insert_siblings_before(tree_nodes, &node.id, &new_node_id);
        });
    }

    /// Parses given fragment html inserts its contents after to the selected node.
    pub fn after_html<T>(&self, html: T)
    where
        T: Into<StrTendril>,
    {
        self.merge_html_with_fn(html, |tree_nodes, new_node_id, node| {
            TreeNodeOps::insert_siblings_after(tree_nodes, &node.id, &new_node_id);
        });
    }

    /// Parses given fragment html and sets its contents to the selected node.
    pub fn set_html<T>(&self, html: T)
    where
        T: Into<StrTendril>,
    {
        self.remove_children();
        self.append_html(html);
    }

    /// Parses given text and sets its contents to the selected node.
    ///
    ///
    /// This operation replaces any contents of the selected node with the given text.
    /// Doesn't escapes the text.
    pub fn set_text<T>(&self, text: T)
    where
        T: Into<StrTendril>,
    {
        let mut nodes = self.tree.nodes.borrow_mut();
        TreeNodeOps::set_text(nodes.deref_mut(), &self.id, text);
    }

    /// Parses given fragment html and appends its contents to the selected node.
    fn merge_html_with_fn<T, F>(&self, html: T, f: F)
    where
        T: Into<StrTendril>,
        F: Fn(&mut Vec<TreeNode>, NodeId, &NodeRef),
    {
        let fragment = Document::fragment(html);
        let mut borrowed_nodes = self.tree.nodes.borrow_mut();
        TreeNodeOps::merge_with_fn(
            &mut borrowed_nodes,
            fragment.tree,
            |tree_nodes, new_node_id| {
                if TreeNodeOps::is_valid_node_id(tree_nodes, &new_node_id) {
                    f(tree_nodes, new_node_id, self);
                }
            },
        );
    }

    /// Wraps the current node in a new parent element.
    /// The parent node becomes the parent of the current node, replacing it in the original structure.
    pub fn wrap_node<P: NodeIdProver>(&self, new_parent: P) {
        let wrapper_id = new_parent.node_id();
        let mut nodes = self.tree.nodes.borrow_mut();

        // Insert wrapper before self in the parent
        TreeNodeOps::insert_before_of(&mut nodes, &self.id, wrapper_id);
        // Move self into wrapper as the only child
        TreeNodeOps::append_child_of(&mut nodes, wrapper_id, &self.id);
    }

    /// Wraps the current node with the given HTML fragment.
    /// The outermost node of the fragment becomes the new parent of the current node.
    ///
    /// **Important:** The HTML fragment must be a **one**, valid HTML element.
    pub fn wrap_html<T>(&self, html: T)
    where
        T: Into<StrTendril>,
    {
        self.merge_html_with_fn(html, |tree_nodes, wrapper_id, node| {
            // Insert wrapper before the node
            TreeNodeOps::insert_before_of(tree_nodes, &node.id, &wrapper_id);
            // Append node into wrapper
            TreeNodeOps::append_child_of(tree_nodes, &wrapper_id, &node.id);
        });
    }

    /// Unwrap the node (and it's siblings) from its parent, removing the parent node from the tree.
    /// If the parent does not exist or is not an element, it does nothing.
    pub fn unwrap_node(&self) {
        if let Some(parent) = self.parent() {
            if !parent.is_element() {
                return; // Only unwrap if parent is an element
            }

            // We can unwrap if there is a grandparent to hold the unwrapped nodes
            if parent.parent().is_some() {
                // Insert self and siblings before parent in grandparent's children
                parent.insert_siblings_before(self);
                // Remove parent from the tree
                parent.remove_from_parent();
            }
        }
    }
}

impl NodeRef<'_> {
    /// Returns the next sibling, that is an [`NodeData::Element`] of the selected node.
    pub fn next_element_sibling(&self) -> Option<Self> {
        let nodes = self.tree.nodes.borrow();
        TreeNodeOps::next_element_sibling_of(nodes.deref(), &self.id)
            .map(|id| NodeRef::new(id, self.tree))
    }

    /// Returns the previous sibling, that is an [`NodeData::Element`] of the selected node.
    pub fn prev_element_sibling(&self) -> Option<Self> {
        let nodes = self.tree.nodes.borrow();
        TreeNodeOps::prev_element_sibling_of(nodes.deref(), &self.id)
            .map(|id| NodeRef::new(id, self.tree))
    }

    /// Returns the first child, that is an [`NodeData::Element`] of the selected node.
    pub fn first_element_child(&self) -> Option<Self> {
        let nodes = self.tree.nodes.borrow();
        TreeNodeOps::first_element_child_of(nodes.deref(), &self.id)
            .map(|id| NodeRef::new(id, self.tree))
    }

    /// Returns children, that are [`NodeData::Element`]s of the selected node.
    pub fn element_children(&self) -> Vec<Self> {
        self.children_it(false).filter(|n| n.is_element()).collect()
    }
}

impl NodeRef<'_> {
    /// Returns the name of the selected node if it is an [`NodeData::Element`] otherwise `None`.
    pub fn node_name(&self) -> Option<StrTendril> {
        let nodes = self.tree.nodes.borrow();
        nodes
            .get(self.id.value)
            .and_then(|node| node.as_element().map(|e| e.node_name()))
    }

    /// Returns the value of the `id` attribute
    pub fn id_attr(&self) -> Option<StrTendril> {
        self.query_or(None, |node| node.as_element().and_then(|e| e.id()))
    }

    /// Returns the value of the `class` attribute
    pub fn class(&self) -> Option<StrTendril> {
        self.query_or(None, |node| node.as_element().and_then(|e| e.class()))
    }

    /// Checks if node has a specified class
    pub fn has_class(&self, class: &str) -> bool {
        self.query_or(false, |node| {
            node.as_element().is_some_and(|e| e.has_class(class))
        })
    }

    /// Adds a class to the node
    pub fn add_class(&self, class: &str) {
        self.update(|node| node.add_class(class));
    }

    /// Removes a class from the node
    pub fn remove_class(&self, class: &str) {
        self.update(|node| node.remove_class(class));
    }

    /// Returns the value of the specified attribute
    pub fn attr(&self, name: &str) -> Option<StrTendril> {
        self.query_or(None, |node| node.as_element().and_then(|e| e.attr(name)))
    }

    /// Returns the value of the specified attribute
    pub fn attr_or<T>(&self, name: &str, default: T) -> StrTendril
    where
        tendril::Tendril<tendril::fmt::UTF8>: std::convert::From<T>,
    {
        self.query_or(None, |node| node.as_element().and_then(|e| e.attr(name)))
            .unwrap_or_else(|| StrTendril::from(default))
    }

    /// Returns all attributes
    pub fn attrs(&self) -> Vec<Attribute> {
        self.query_or(vec![], |node| {
            node.as_element().map_or(vec![], |e| copy_attrs(&e.attrs))
        })
    }

    /// Sets the value of the specified attribute to the node.
    pub fn set_attr(&self, name: &str, val: &str) {
        self.update(|node| node.set_attr(name, val));
    }

    /// Removes the specified attribute from the element.
    pub fn remove_attr(&self, name: &str) {
        self.update(|node| node.remove_attr(name));
    }

    /// Removes the specified attributes from the element.
    ///
    /// # Arguments
    /// - `names`: A slice of attribute names to remove. Empty slice removes no attributes.
    pub fn remove_attrs(&self, names: &[&str]) {
        self.update(|node| node.remove_attrs(names));
    }

    /// Retains only the attributes with the specified names.
    ///
    /// # Arguments
    /// - `names`: A slice of attribute names to retain. Empty slice retains no attributes.
    pub fn retain_attrs(&self, names: &[&str]) {
        self.update(|node| node.retain_attrs(names));
    }

    /// Removes all attributes from the element.
    pub fn remove_all_attrs(&self) {
        self.update(|node| node.remove_all_attrs());
    }

    /// Checks if node has a specified attribute
    pub fn has_attr(&self, name: &str) -> bool {
        self.query_or(false, |node| {
            node.as_element().is_some_and(|e| e.has_attr(name))
        })
    }

    /// Renames the node if node is an [`NodeData::Element`].
    pub fn rename(&self, name: &str) {
        self.update(|node| node.rename(name));
    }
}

impl NodeRef<'_> {
    /// Returns true if this node is a document.
    pub fn is_document(&self) -> bool {
        self.query_or(false, |node| node.is_document())
    }

    /// Returns true if this node is a fragment.
    pub fn is_fragment(&self) -> bool {
        self.query_or(false, |node| node.is_fragment())
    }

    /// Returns true if this node is an element.
    pub fn is_element(&self) -> bool {
        self.query_or(false, |node| node.is_element())
    }

    /// Returns true if this node is a text node.
    pub fn is_text(&self) -> bool {
        self.query_or(false, |node| node.is_text())
    }
    /// Returns true if this node is a comment.
    pub fn is_comment(&self) -> bool {
        self.query_or(false, |node| node.is_comment())
    }
    /// Returns true if this node is a DOCTYPE.
    pub fn is_doctype(&self) -> bool {
        self.query_or(false, |node| node.is_doctype())
    }

    /// Checks if node may have children nodes.
    pub fn may_have_children(&self) -> bool {
        self.query_or(false, |node| node.may_have_children())
    }
}

impl NodeRef<'_> {
    /// Returns the HTML representation of the DOM tree.
    /// Panics if serialization fails.
    pub fn html(&self) -> StrTendril {
        self.serialize_html(TraversalScope::IncludeNode).unwrap()
    }

    /// Returns the HTML representation of the DOM tree without the outermost node.
    /// Panics if serialization fails.
    pub fn inner_html(&self) -> StrTendril {
        self.serialize_html(TraversalScope::ChildrenOnly(None))
            .unwrap()
    }

    // Returns the HTML representation of the DOM tree, if it succeeds or `None`.
    pub fn try_html(&self) -> Option<StrTendril> {
        self.serialize_html(TraversalScope::IncludeNode)
    }

    // Returns the HTML representation of the DOM tree without the outermost node, if it succeeds or `None`.
    pub fn try_inner_html(&self) -> Option<StrTendril> {
        self.serialize_html(TraversalScope::ChildrenOnly(None))
    }

    fn serialize_html(&self, traversal_scope: TraversalScope) -> Option<StrTendril> {
        let inner: SerializableNodeRef = (*self).into();
        let mut result = vec![];
        serialize(
            &mut result,
            &inner,
            SerializeOpts {
                scripting_enabled: false,
                create_missing_parent: false,
                traversal_scope,
            },
        )
        .ok()?;
        StrTendril::try_from_byte_slice(&result).ok()
    }

    /// Returns the text of the node and its descendants.
    pub fn text(&self) -> StrTendril {
        let nodes = self.tree.nodes.borrow();
        TreeNodeOps::text_of(nodes, self.id)
    }

    /// Returns the text of the node without its descendants.
    pub fn immediate_text(&self) -> StrTendril {
        let nodes = self.tree.nodes.borrow();
        TreeNodeOps::immediate_text_of(nodes, self.id)
    }

    /// Returns the formatted text of the node and its descendants. This is the same as
    /// the `text()` method, but with a few differences:
    ///
    /// - Whitespace is normalized so that there is only one space between words.
    /// - All whitespace is removed from the beginning and end of the text.
    /// - After block elements, a double newline is added.
    /// - For elements like `br`, 'hr', 'li', 'tr' a single newline is added.
    pub fn formatted_text(&self) -> StrTendril {
        format_text(self, false)
    }

    /// Checks if the node contains the specified text
    pub fn has_text(&self, needle: &str) -> bool {
        let nodes = self.tree.nodes.borrow();
        let id = self.id;
        let node_ids = std::iter::once(id).chain(descendant_nodes(Ref::clone(&nodes), &id));
        for node in node_ids.filter_map(|node_id| nodes.get(node_id.value)) {
            if let NodeData::Text { ref contents } = node.data {
                if contents.contains(needle) {
                    return true;
                }
            }
        }
        false
    }

    /// Checks if the node contains only text node
    pub fn has_only_text(&self) -> bool {
        let nodes = self.tree.nodes.borrow();
        if child_nodes(Ref::clone(&nodes), &self.id, false).count() == 1 {
            let first_child = nodes
                .get(self.id.value)
                .and_then(|n| n.first_child)
                .and_then(|id| nodes.get(id.value));
            first_child.is_some_and(|n| {
                n.is_text()
                    && !TreeNodeOps::text_of(Ref::clone(&nodes), n.id)
                        .trim()
                        .is_empty()
            })
        } else {
            false
        }
    }

    /// Checks if the node is an empty element.
    ///
    /// Determines if the node is an element, has no child elements, and any text nodes
    /// it contains consist only of whitespace.
    pub fn is_empty_element(&self) -> bool {
        let nodes = self.tree.nodes.borrow();
        let Some(node) = nodes.get(self.id.value) else {
            return false;
        };
        node.is_element()
            && !child_nodes(Ref::clone(&nodes), &self.id, false)
                .flat_map(|id| nodes.get(id.value))
                .any(|child| {
                    child.is_element()
                        || (child.is_text()
                            && !TreeNodeOps::text_of(Ref::clone(&nodes), child.id)
                                .trim()
                                .is_empty())
                })
    }

    /// Merges adjacent text nodes and removes empty text nodes.
    ///
    /// Normalization is necessary to ensure that adjacent text nodes are merged into one text node.
    pub fn normalize(&self) {
        let mut child = self.first_child();
        let mut text: StrTendril = StrTendril::new();

        while let Some(ref node) = child {
            let next_node = node.next_sibling();

            if node.is_text() {
                text.push_tendril(&node.text());
                if !next_node.as_ref().is_some_and(|n| n.is_text()) && !text.is_empty() {
                    let t = text;
                    text = StrTendril::new();
                    node.set_text(t);
                } else {
                    node.remove_from_parent();
                }
            } else if node.may_have_children() {
                node.normalize();
            }
            child = next_node;
        }
    }

    /// Strips all elements with the specified names from the node's descendants.
    ///
    /// If matched element has children, they will be assigned to the parent of the matched element.
    ///
    /// # Arguments
    /// * `names` - A list of element names to strip.
    pub fn strip_elements(&self, names: &[&str]) {
        if names.is_empty() {
            return;
        }
        let mut child = self.first_child();

        while let Some(ref child_node) = child {
            let next_node = child_node.next_sibling();
            if child_node.may_have_children() {
                child_node.strip_elements(names);
            }
            if !child_node.is_element() {
                child = next_node;
                continue;
            }
            if child_node
                .qual_name_ref()
                .is_some_and(|name| names.contains(&name.local.as_ref()))
            {
                if let Some(first_inline) = child_node.first_child() {
                    child_node.insert_siblings_before(&first_inline);
                };
                child_node.remove_from_parent();
            }
            child = next_node;
        }
    }

    /// Creates a full copy of the node's contents as a [Document] fragment.
    pub fn to_fragment(&self) -> Document {
        if self.id.value == 0 || self.has_name("html") {
            return Document {
                tree: self.tree.clone(),
                ..Default::default()
            };
        }

        let frag = Document::fragment_sink();
        let f_tree = &frag.tree;
        let f_root_id = f_tree.root().id;

        f_tree.new_element("body");

        let html_node = f_tree.new_element("html");
        f_tree.append_child_of(&f_root_id, &html_node.id);

        {
            let new_child_id = f_tree.copy_node(self);
            let mut fragment_nodes = f_tree.nodes.borrow_mut();
            TreeNodeOps::append_children_of(&mut fragment_nodes, &html_node.id, &new_child_id);
        }

        frag
    }
}

impl NodeRef<'_> {
    /// Checks if the node matches the given matcher
    pub fn is_match(&self, matcher: &Matcher) -> bool {
        self.is_element() && matcher.match_element(self)
    }

    /// Checks if the node matches the given selector
    pub fn is(&self, sel: &str) -> bool {
        Matcher::new(sel).is_ok_and(|matcher| self.is_match(&matcher))
    }

    /// Returns the base URI of the document.
    ///
    /// This is the value of the `<base>` element in the document's head, or `None` if the document does not have a `<base>` element.
    pub fn base_uri(&self) -> Option<StrTendril> {
        self.tree.base_uri()
    }

    /// Finds all descendant elements of this node that match the given path.
    ///
    /// The path is a sequence of element names. The method returns a vector of
    /// [`NodeRef`]s that correspond to the matching elements. The elements are
    /// returned in the order they appear in the document tree.
    ///
    /// # Experimental
    /// This method is experimental and may change in the future. The `path` argument will be revised.
    pub fn find(&self, path: &[&str]) -> Vec<Self> {
        let nodes = self.tree.nodes.borrow();
        let found_ids = Traversal::find_descendant_elements(&nodes, self.id, path);
        found_ids
            .iter()
            .map(|node_id| NodeRef::new(*node_id, self.tree))
            .collect()
    }

    /// Traverses the tree and counts all text content of a node and its descendants,
    /// but only counting each sequence of whitespace as a single character.
    ///
    /// This function will traverse the tree and count all text content
    /// from the node and its descendants.
    ///
    /// It has an advantage over `node.text().split_whitespace().count()`
    /// because it doesn't need to collect and consume the text content.
    ///
    /// # Returns
    /// The number of characters that would be in the text content if it were normalized,
    /// where normalization means treating any sequence of whitespace characters as a single space.
    pub fn normalized_char_count(&self) -> usize {
        let nodes = self.tree.nodes.borrow();
        TreeNodeOps::normalized_char_count(nodes, self.id)
    }
}

impl<'a> NodeRef<'a> {
    /// Returns a reference to the element node that this node references, if it is an element.
    ///
    /// Returns `None` if the node is not an element.
    pub fn element_ref(&self) -> Option<Ref<'a, Element>> {
        Ref::filter_map(self.tree.nodes.borrow(), |nodes| {
            let node = nodes.get(self.id.value)?;
            if let NodeData::Element(ref el) = node.data {
                Some(el)
            } else {
                None
            }
        })
        .ok()
    }

    /// Gets node's qualified name
    ///
    /// Returns `None` if the node is not an element or the element name cannot be accessed.
    pub fn qual_name_ref(&self) -> Option<Ref<'a, QualName>> {
        self.tree.get_name(&self.id)
    }

    /// Checks if the node is an element with the given name.
    ///
    /// Returns `false` if the node is not an element.
    pub fn has_name(&self, name: &str) -> bool {
        self.element_ref()
            .is_some_and(|el| el.name.local.as_ref() == name)
    }

    /// Checks if the node is a nonempty text node.
    ///
    /// Returns `true` if the node is a text node and its text content is not empty.
    /// Returns `false` if the node is not a text node or its text content is empty.
    pub fn is_nonempty_text(&self) -> bool {
        self.query_or(false, |t| {
            if let NodeData::Text { ref contents } = t.data {
                contents.chars().any(|c| !c.is_whitespace())
            } else {
                false
            }
        })
    }
}

#[cfg(feature = "markdown")]
impl NodeRef<'_> {
    /// Produces a *Markdown* representation of the node and its descendants,  
    /// skipping elements matching the specified `skip_tags` list along with their descendants.  
    ///  
    /// - If `skip_tags` is `None`, the default list is used: `["script", "style", "meta", "head"]`.  
    /// - To process all elements without exclusions, pass `Some(&[])`.
    pub fn md(&self, skip_tags: Option<&[&str]>) -> StrTendril {
        crate::serializing::serialize_md(self, false, skip_tags)
    }
}
