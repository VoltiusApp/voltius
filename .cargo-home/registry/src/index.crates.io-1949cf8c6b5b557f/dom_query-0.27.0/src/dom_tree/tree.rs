use std::cell::{Ref, RefCell};
use std::fmt::{self, Debug};
use std::ops::{Deref, DerefMut};

#[allow(unused_imports)]
use html5ever::namespace_url;
use html5ever::LocalName;
use html5ever::{ns, QualName};
use tendril::StrTendril;

use crate::entities::{wrap_tendril, InnerHashMap};
use crate::node::{
    ancestor_nodes, child_nodes, descendant_nodes, AncestorNodes, ChildNodes, DescendantNodes,
};
use crate::node::{Element, NodeData, NodeId, NodeRef, TreeNode};

use super::ops::TreeNodeOps;
use super::traversal::Traversal;

/// An implementation of arena-tree.
pub struct Tree {
    pub(crate) nodes: RefCell<Vec<TreeNode>>,
}

impl Debug for Tree {
    fn fmt(&self, fmt: &mut fmt::Formatter) -> fmt::Result {
        fmt.debug_struct("Tree").finish()
    }
}

impl Clone for Tree {
    fn clone(&self) -> Self {
        let nodes = self.nodes.borrow();
        Self {
            nodes: RefCell::new(nodes.clone()),
        }
    }
}

impl Tree {
    /// Creates a new element with the given name and HTML namespace, without parent
    pub fn new_element(&self, name: &str) -> NodeRef<'_> {
        let name = QualName::new(None, ns!(html), LocalName::from(name));
        self.new_element_qualname(name)
    }

    /// Creates a new element with the specified [`QualName`] without a parent.
    ///
    /// This is a low-level constructor that allows control over the element
    /// name, including namespace and prefix. This can be useful when
    /// creating elements in non-HTML namespaces (e.g. SVG or MathML).
    pub fn new_element_qualname(&self, name: QualName) -> NodeRef<'_> {
        let el = Element::new(name, Vec::new(), None, false);
        let id = self.create_node(NodeData::Element(el));
        NodeRef::new(id, self)
    }

    /// Creates a new text node with the given text, without parent
    pub fn new_text<T: Into<StrTendril>>(&self, text: T) -> NodeRef<'_> {
        let text = text.into();
        let id = self.create_node(NodeData::Text {
            contents: wrap_tendril(text),
        });
        NodeRef::new(id, self)
    }

    /// Gets node's name by by id
    pub fn get_name<'a>(&'a self, id: &NodeId) -> Option<Ref<'a, QualName>> {
        Ref::filter_map(self.nodes.borrow(), |nodes| {
            let node = nodes.get(id.value)?;
            if let NodeData::Element(ref el) = node.data {
                Some(&el.name)
            } else {
                None
            }
        })
        .ok()
    }

    /// Finds the base URI of the tree by looking for `<base>` tags in document's head.
    ///
    /// The base URI is the value of the `href` attribute of the first
    /// `<base>` tag in the document's head. If no such tag is found,
    /// the method returns `None`.
    ///
    /// This is a very fast method compare to [`crate::Document::select`].
    pub fn base_uri(&self) -> Option<StrTendril> {
        // TODO: It is possible to wrap the result of this function with `OnceCell`,
        // but then appears a problem with atomicity and the `Send` trait for the Tree.
        let root = self.root();
        let nodes = self.nodes.borrow();

        Traversal::find_descendant_element(Ref::clone(&nodes), root.id, &["html", "head", "base"])
            .and_then(|base_node_id| nodes.get(base_node_id.value))
            .and_then(|base_node| base_node.as_element()?.attr("href"))
    }

    /// Finds the `<body>` node element in the tree.
    /// For fragments ([crate::NodeData::Fragment]), this typically returns `None`.
    pub fn body(&self) -> Option<NodeRef<'_>> {
        let root = self.root();
        Traversal::find_descendant_element(self.nodes.borrow(), root.id, &["html", "body"])
            .map(|body_id| NodeRef::new(body_id, self))
    }

    /// Finds the `<head>` node element in the tree.
    /// For fragments ([crate::NodeData::Fragment]), this typically returns `None`.
    pub fn head(&self) -> Option<NodeRef<'_>> {
        let root = self.root();
        Traversal::find_descendant_element(self.nodes.borrow(), root.id, &["html", "head"])
            .map(|head_id| NodeRef::new(head_id, self))
    }

    /// Checks if the node is a MathML annotation-xml integration point.
    /// Returns `false` if the node does not exist or is not an element.
    pub fn is_mathml_annotation_xml_integration_point(&self, node_id: &NodeId) -> bool {
        self.nodes
            .borrow()
            .get(node_id.value)
            .and_then(|n| n.as_element())
            .is_some_and(|e| e.mathml_annotation_xml_integration_point)
    }
}

impl Tree {
    /// Returns the root node.
    pub fn root_id(&self) -> NodeId {
        NodeId { value: 0 }
    }

    /// Creates a new tree with the given root.
    pub fn new(root: NodeData) -> Self {
        let root_id = NodeId::new(0);
        Self {
            nodes: RefCell::new(vec![TreeNode::new(root_id, root)]),
        }
    }
    /// Creates a new node with the given data.
    pub fn create_node(&self, data: NodeData) -> NodeId {
        let mut nodes = self.nodes.borrow_mut();
        TreeNodeOps::create_node(nodes.deref_mut(), data)
    }

    /// Gets node by id
    pub fn get(&self, id: &NodeId) -> Option<NodeRef<'_>> {
        let nodes = self.nodes.borrow();
        nodes.get(id.value).map(|_| NodeRef::new(*id, self))
    }

    /// Gets node by id
    pub fn get_unchecked(&self, id: &NodeId) -> NodeRef<'_> {
        NodeRef::new(*id, self)
    }

    /// Gets the root node
    pub fn root(&self) -> NodeRef<'_> {
        self.get_unchecked(&NodeId::new(0))
    }

    /// Gets the element root node.
    ///
    /// Even if [crate::Document] was constructed with an empty string,
    /// it will still have a root element node (`<html>`).
    ///
    /// # Returns
    /// - `NodeRef`: The root element (`<html>`) node.
    pub fn html_root(&self) -> NodeRef<'_> {
        self.root()
            .first_element_child()
            .expect("expecting 'html' element")
    }

    /// Gets the ancestors nodes of a node by id.
    ///
    /// # Arguments
    /// * `id` - The id of the node.
    /// * `max_depth` - The maximum depth of the ancestors. If `None`, or Some(0) the maximum depth is unlimited.
    ///
    /// # Returns
    /// `Vec<NodeRef<'_>>` - A vector of ancestors nodes.
    pub fn ancestors_of(&self, id: &NodeId, max_depth: Option<usize>) -> Vec<NodeRef<'_>> {
        self.ancestor_ids_of_it(id, max_depth)
            .map(|id| NodeRef::new(id, self))
            .collect()
    }

    /// Returns the ancestor node ids of a node by id.
    ///
    /// # Arguments
    ///
    /// * `id` - The id of the node.
    /// * `max_depth` - The maximum depth of the ancestors. If `None`, or Some(0) the maximum depth is unlimited.
    ///
    /// # Returns
    ///
    /// `Vec<NodeId>` - A vector of ancestor node ids.
    pub fn ancestor_ids_of(&self, id: &NodeId, max_depth: Option<usize>) -> Vec<NodeId> {
        self.ancestor_ids_of_it(id, max_depth).collect()
    }

    /// Returns an iterator of the ancestor node ids of a node by id
    ///
    /// # Arguments
    ///
    /// * `id` - The id of the node.
    /// * `max_depth` - The maximum depth of the ancestors. If `None`, or Some(0) the maximum depth is unlimited.
    ///
    /// # Returns
    ///
    /// `AncestorNodes<'a, T>` - An iterator of ancestor node ids.
    pub fn ancestor_ids_of_it(&self, id: &NodeId, max_depth: Option<usize>) -> AncestorNodes<'_> {
        ancestor_nodes(self.nodes.borrow(), id, max_depth)
    }

    /// Returns children of the selected node.
    ///
    /// # Arguments
    ///
    /// * `id` - The id of the node.
    ///
    /// # Returns
    ///
    /// `Vec<NodeRef<T>>` - A vector of children nodes.
    pub fn children_of(&self, id: &NodeId) -> Vec<NodeRef<'_>> {
        child_nodes(self.nodes.borrow(), id, false)
            .map(move |id| NodeRef::new(id, self))
            .collect()
    }

    /// Returns an iterator of the child node ids of a node by id
    ///
    /// # Arguments
    ///
    /// * `id` - The id of the node.
    /// * `rev` - If `true`, returns the children in reverse order.
    pub fn child_ids_of_it(&self, id: &NodeId, rev: bool) -> ChildNodes<'_> {
        child_nodes(self.nodes.borrow(), id, rev)
    }

    /// Returns a vector of the child node ids of a node by id
    ///
    /// # Arguments
    ///
    /// * `id` - The id of the node.
    pub fn child_ids_of(&self, id: &NodeId) -> Vec<NodeId> {
        child_nodes(self.nodes.borrow(), id, false).collect()
    }

    /// Returns an iterator of the descendant node ids of a node by id
    ///
    /// # Arguments
    ///
    /// * `id` - The id of the node.
    ///
    /// # Returns
    ///
    /// `DescendantNodes<'_>`
    pub fn descendant_ids_of_it(&self, id: &NodeId) -> DescendantNodes<'_> {
        descendant_nodes(self.nodes.borrow(), id)
    }

    /// Gets the first child node of a node by id
    pub fn first_child_of(&self, id: &NodeId) -> Option<NodeRef<'_>> {
        let nodes = self.nodes.borrow();
        let node = nodes.get(id.value)?;
        node.first_child.map(|id| NodeRef::new(id, self))
    }

    /// Gets the last child node of a node by id
    pub fn last_child_of(&self, id: &NodeId) -> Option<NodeRef<'_>> {
        let nodes = self.nodes.borrow();
        let node = nodes.get(id.value)?;
        node.last_child.map(|id| NodeRef::new(id, self))
    }

    /// Gets the parent node of a node by id
    pub fn parent_of(&self, id: &NodeId) -> Option<NodeRef<'_>> {
        let nodes = self.nodes.borrow();
        let node = nodes.get(id.value)?;
        node.parent.map(|id| NodeRef::new(id, self))
    }

    /// Gets the previous sibling node of a node by id
    pub fn prev_sibling_of(&self, id: &NodeId) -> Option<NodeRef<'_>> {
        let nodes = self.nodes.borrow();
        let node = nodes.get(id.value)?;
        node.prev_sibling.map(|id| NodeRef::new(id, self))
    }

    /// Gets the next sibling node of a node by id
    pub fn next_sibling_of(&self, id: &NodeId) -> Option<NodeRef<'_>> {
        let nodes = self.nodes.borrow();
        let node = nodes.get(id.value)?;
        node.next_sibling.map(|id| NodeRef::new(id, self))
    }

    /// Gets the last sibling node of a node by id
    pub fn last_sibling_of(&self, id: &NodeId) -> Option<NodeRef<'_>> {
        let nodes = self.nodes.borrow();
        TreeNodeOps::last_sibling_of(nodes.deref(), id).map(|id| NodeRef::new(id, self))
    }

    /// A helper function to get the node from the tree and apply a function to it.
    pub fn query_node<F, B>(&self, id: &NodeId, f: F) -> Option<B>
    where
        F: FnOnce(&TreeNode) -> B,
    {
        let nodes = self.nodes.borrow();
        nodes.get(id.value).map(f)
    }

    /// A helper function to get the node from the tree and apply a function to it.
    /// Accepts a default value to return for a case if the node doesn't exist.
    pub fn query_node_or<F, B>(&self, id: &NodeId, default: B, f: F) -> B
    where
        F: FnOnce(&TreeNode) -> B,
    {
        let nodes = self.nodes.borrow();
        nodes.get(id.value).map_or(default, f)
    }

    /// A helper function to get the node from the tree and apply a function to it that modifies it.
    pub fn update_node<F, B>(&self, id: &NodeId, f: F) -> Option<B>
    where
        F: FnOnce(&mut TreeNode) -> B,
    {
        let mut nodes = self.nodes.borrow_mut();
        let node = nodes.get_mut(id.value)?;
        let r = f(node);
        Some(r)
    }

    /// This function is some kind of: get two nodes from a tree and apply some closure to them.
    /// Possibly will be removed in the future.
    pub fn compare_node<F, B>(&self, a: &NodeId, b: &NodeId, f: F) -> Option<B>
    where
        F: FnOnce(&TreeNode, &TreeNode) -> B,
    {
        let nodes = self.nodes.borrow();
        let node_a = nodes.get(a.value)?;
        let node_b = nodes.get(b.value)?;

        Some(f(node_a, node_b))
    }
}

// Tree modification methods
impl Tree {
    /// Creates a new element from data  and appends it to a node by id
    pub fn append_child_data_of(&self, id: &NodeId, data: NodeData) {
        let mut nodes = self.nodes.borrow_mut();
        TreeNodeOps::append_child_data_of(nodes.deref_mut(), id, data);
    }

    /// Appends a child node by `new_child_id` to a node by `id`. `new_child_id` must exist in the tree.
    pub fn append_child_of(&self, id: &NodeId, new_child_id: &NodeId) {
        let mut nodes = self.nodes.borrow_mut();
        TreeNodeOps::append_child_of(nodes.deref_mut(), id, new_child_id);
    }

    /// Prepend a child node by `new_child_id` to a node by `id`. `new_child_id` must exist in the tree.
    pub fn prepend_child_of(&self, id: &NodeId, new_child_id: &NodeId) {
        let mut nodes = self.nodes.borrow_mut();
        TreeNodeOps::prepend_child_of(nodes.deref_mut(), id, new_child_id);
    }

    /// Remove a node from the its parent by id. The node remains in the tree.
    /// It is possible to assign it to another node in the tree after this operation.
    pub fn remove_from_parent(&self, id: &NodeId) {
        let mut nodes = self.nodes.borrow_mut();
        TreeNodeOps::remove_from_parent(nodes.deref_mut(), id);
    }

    /// Append a sibling node in the tree before the given node.
    pub fn insert_before_of(&self, id: &NodeId, new_sibling_id: &NodeId) {
        let mut nodes = self.nodes.borrow_mut();
        TreeNodeOps::insert_before_of(nodes.deref_mut(), id, new_sibling_id);
    }

    /// Append a sibling node in the tree after the given node.
    pub fn insert_after_of(&self, id: &NodeId, new_sibling_id: &NodeId) {
        let mut nodes = self.nodes.borrow_mut();
        TreeNodeOps::insert_after_of(nodes.deref_mut(), id, new_sibling_id);
    }

    /// Changes the parent of children nodes of a node.
    pub fn reparent_children_of(&self, id: &NodeId, new_parent_id: Option<NodeId>) {
        let mut nodes = self.nodes.borrow_mut();
        TreeNodeOps::reparent_children_of(nodes.deref_mut(), id, new_parent_id);
    }

    /// Detaches the children of a node.
    pub fn remove_children_of(&self, id: &NodeId) {
        self.reparent_children_of(id, None)
    }
}

impl Tree {
    /// Get the new id, that is not in the Tree.
    ///
    /// This function doesn't add a new id.
    /// it is just a convenient wrapper to get the new id.
    pub(crate) fn get_new_id(&self) -> NodeId {
        NodeId::new(self.nodes.borrow().len())
    }

    ///Adds a copy of the node and its children to the current tree.
    ///
    /// Note: For `<template>` elements, the associated `template_contents` fragment (if any)
    /// is also copied and its IDs remapped to the destination tree.
    ///
    /// # Arguments
    ///
    /// * `node` - reference to a node in the source tree (may be the same tree)
    ///
    ///
    /// # Returns
    ///
    /// * `NodeId` - id of the new node, that was added into the current tree
    pub(crate) fn copy_node(&self, node: &NodeRef) -> NodeId {
        let base_id = self.get_new_id();
        let mut next_id_val = base_id.value;

        let mut id_map: InnerHashMap<usize, usize> = InnerHashMap::default();
        id_map.insert(node.id.value, next_id_val);

        let mut ops = vec![*node];

        while let Some(op) = ops.pop() {
            for child in op.children_it(false) {
                next_id_val += 1;
                id_map.insert(child.id.value, next_id_val);
                if let Some(tpl_id) = child.element_ref().and_then(|el| el.template_contents) {
                    next_id_val += 1;
                    id_map.insert(tpl_id.value, next_id_val);
                    ops.push(NodeRef::new(tpl_id, child.tree));
                }
            }

            ops.extend(op.children_it(true));
        }

        // source tree may be the same tree that owns the copy_node fn, and may be not.
        let source_tree = node.tree;
        let new_nodes = Self::copy_tree_nodes(source_tree, &id_map);

        let mut nodes = self.nodes.borrow_mut();
        nodes.extend(new_nodes);

        base_id
    }

    fn copy_tree_nodes(source_tree: &Tree, id_map: &InnerHashMap<usize, usize>) -> Vec<TreeNode> {
        let mut new_nodes: Vec<TreeNode> = Vec::with_capacity(id_map.len());
        let source_nodes = source_tree.nodes.borrow();
        let adjust_id = |old_id: NodeId| id_map.get(&old_id.value).map(|id| NodeId::new(*id));
        let tree_nodes_it = id_map.iter().flat_map(|(old_id, new_id)| {
            source_nodes.get(*old_id).map(|orig_node| {
                let mut data = orig_node.data.clone();
                if let NodeData::Element(ref mut el) = data {
                    el.template_contents = el.template_contents.and_then(adjust_id)
                }
                TreeNode {
                    id: NodeId::new(*new_id),
                    parent: orig_node.parent.and_then(adjust_id),
                    prev_sibling: orig_node.prev_sibling.and_then(adjust_id),
                    next_sibling: orig_node.next_sibling.and_then(adjust_id),
                    first_child: orig_node.first_child.and_then(adjust_id),
                    last_child: orig_node.last_child.and_then(adjust_id),
                    data,
                }
            })
        });
        new_nodes.extend(tree_nodes_it);
        new_nodes.sort_by_key(|k| k.id.value);
        new_nodes
    }

    /// Copies each node from `other_nodes` (and its subtree) to the current tree and
    /// applies the given function once per top-level copied node. The function is called
    /// with the ID of each top-level copied node (not each descendant).
    ///
    /// # Arguments
    ///
    /// * `other_nodes` - slice of nodes to be copied
    /// * `f` - function to be applied to each copied node
    pub(crate) fn copy_nodes_with_fn<F>(&self, other_nodes: &[NodeRef], mut f: F)
    where
        F: FnMut(NodeId),
    {
        // copying each other node into the current tree, and applying the function
        for other_node in other_nodes {
            let new_node_id = self.copy_node(other_node);
            f(new_node_id);
        }
    }
}

#[rustfmt::skip]
#[cfg(test)]
mod tests {
    use crate::Document;
    use crate::NodeId;

    static CONTENTS: &str = r#"
        <!DOCTYPE html>
        <html>
            <head><title>Test</title></head>
            <body>
                <div>
                    <p id="first-child">foo</p>
                    <p id="last-child">bar</p>
                </div>
            </body>
        </html>
    "#;

    #[test]
    fn test_tree_get() {
        let doc = Document::from(CONTENTS);
        let tree = &doc.tree;
        // root node 0 always exists
        assert!(tree.get(&NodeId::new(0)).is_some());
        // within 0..total_nodes.len() range all nodes are accessible
        let total_nodes = tree.nodes.borrow().len();
        assert!(tree.get(&NodeId::new(total_nodes - 1)).is_some());
        assert!(tree.get(&NodeId::new(total_nodes)).is_none());

        let validity_check = tree.validate();
        assert!(validity_check.is_ok(),"Tree is not valid: {}",validity_check.unwrap_err());
    }

    #[test]
    fn test_ancestors_of() {
        let doc = Document::from(CONTENTS);
        let tree = &doc.tree;

        let last_child_sel = doc.select_single("#last-child");
        let last_child = last_child_sel.nodes().first().unwrap();
        let ancestors = tree.ancestor_ids_of(&last_child.id, None);
        let elder_id = ancestors[ancestors.len() - 1];
        // the eldest ancestor is document root, which is not an element node
        assert_eq!(elder_id, NodeId::new(0));

        let elder_node = tree.get(&elder_id).unwrap();
        assert!(elder_node.node_name().is_none());
        assert!(elder_node.is_document());

        let validity_check = tree.validate();
        assert!(validity_check.is_ok(),"Tree is not valid: {}",validity_check.unwrap_err());
    }

    #[test]
    fn test_child_ids_of() {
        let doc = Document::from(CONTENTS);
        let tree = &doc.tree;

        let parent_sel = doc.select_single("body > div");
        let parent_node = parent_sel.nodes().first().unwrap();
        //`child_ids_of_it` is more flexible than `child_ids_of`, but `child_ids_of` is more safe when it comes to change the tree.
        for child_id in tree.child_ids_of(&parent_node.id) {
            tree.remove_from_parent(&child_id);
        }
        assert!(!doc.select("#first-child, #last-child").exists());

        let validity_check = tree.validate();
        assert!(validity_check.is_ok(),"Tree is not valid: {}",validity_check.unwrap_err());
    }

    #[test]
    fn test_prepend_child_of() {
        let doc = Document::from(CONTENTS);
        let tree = &doc.tree;

        let parent_sel = doc.select_single("body > div");
        let parent_node = parent_sel.nodes().first().unwrap();

        let new_node = tree.new_element("p");
        new_node.set_attr("id", "oops");

        tree.prepend_child_of(&parent_node.id, &new_node.id);
        assert!(doc
            .select("body > div > #oops + #first-child + #last-child")
            .exists());

        let validity_check = tree.validate();
        assert!(validity_check.is_ok(),"Tree is not valid: {}",validity_check.unwrap_err());
    }

    #[test]
    fn test_invalid_multiple_roots() {
        use super::*;
        let tree = Tree {
            nodes: RefCell::new(vec![
                TreeNode::new(NodeId::new(0), NodeData::Document),
                TreeNode {
                    id: NodeId::new(1),
                    parent: None, // Orphaned node allowed
                    ..TreeNode::new(
                        NodeId::new(1),
                        NodeData::Element(Element::new(
                            QualName::new(None, ns!(), LocalName::from("div")),
                            vec![],
                            None,
                            false,
                        )),
                    )
                },
            ]),
        };

        // Tamper root node
        tree.nodes.borrow_mut()[0].parent = Some(NodeId::new(1)); // Invalid root parent

        let result = tree.validate();
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .contains("Root node (NodeId(0)) must have no parent"));
    }

    #[test]
    fn test_invalid_sibling_link() {
        use super::*;
        let tree = Tree::new(NodeData::Document);
        let child1_id = tree.create_node(NodeData::Element(Element::new(
            QualName::new(None, ns!(), LocalName::from("p")),
            vec![],
            None,
            false,
        )));
        let child2_id = tree.create_node(NodeData::Element(Element::new(
            QualName::new(None, ns!(), LocalName::from("p")),
            vec![],
            None,
            false,
        )));

        // Add incorrect sibling links
        {
            let mut nodes = tree.nodes.borrow_mut();
            let root = &mut nodes[0];
            root.first_child = Some(child1_id);
            root.last_child = Some(child2_id);
        }
        {
            let mut nodes = tree.nodes.borrow_mut();
            let child1 = &mut nodes[child1_id.value];
            child1.parent = Some(tree.root().id);
            child1.next_sibling = Some(child2_id);
        }
        {
            let mut nodes = tree.nodes.borrow_mut();
            let child2 = &mut nodes[child2_id.value];
            child2.parent = Some(tree.root().id);
            child2.prev_sibling = Some(NodeId::new(999)); // Invalid prev_sibling mismatch
        }

        let result = tree.validate();
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("prev_sibling"));
    }

    #[test]
    fn test_cycle_in_parent_chain() {
        use super::*;

        // Create two orphan nodes that point to each other as parent
        let tree = Tree::new(NodeData::Document);
        let x_id = tree.create_node(NodeData::Element(Element::new(
            QualName::new(None, ns!(), LocalName::from("div")),
            Vec::new(),
            None,
            false,
        )));
        let y_id = tree.create_node(NodeData::Element(Element::new(
            QualName::new(None, ns!(), LocalName::from("span")),
            Vec::new(),
            None,
            false,
        )));
        {
            let mut nodes = tree.nodes.borrow_mut();
            nodes[x_id.value].parent = Some(y_id);
            nodes[y_id.value].parent = Some(x_id);
        }
        let err = tree.validate().unwrap_err();
        assert!(err.contains("Cycle detected"));
    }
}
