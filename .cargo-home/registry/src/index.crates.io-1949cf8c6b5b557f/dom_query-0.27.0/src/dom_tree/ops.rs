use std::cell::Ref;

use tendril::StrTendril;

use super::helpers::normalized_char_count;
use super::Tree;

use crate::entities::{into_tendril, wrap_tendril, StrWrap};
use crate::node::{child_nodes, descendant_nodes};
use crate::node::{NodeData, NodeId, TreeNode};
pub struct TreeNodeOps {}

/// Number of leading scaffold nodes to skip when merging parsed fragments
const SKIP_NODES_ON_MERGE: usize = 3;

// property
impl TreeNodeOps {
    /// Collects all text content of a node and its descendants.
    ///
    /// # Arguments
    ///
    /// - `nodes`: a reference to a vector of `TreeNode`s.
    /// - `id`: `NodeId` of the element to get the text content from.
    ///
    /// This function will traverse the tree and collect all text content
    /// from the node and its descendants. It will ignore any nodes that
    /// are not `Element`s or `Text`s.
    ///
    /// The function returns a `StrTendril` containing all collected text content.
    pub fn text_of(nodes: Ref<Vec<TreeNode>>, id: NodeId) -> StrTendril {
        let node_ids = std::iter::once(id).chain(descendant_nodes(Ref::clone(&nodes), &id));

        let text = node_ids
            .filter_map(|node_id| nodes.get(node_id.value))
            .filter_map(|node| match &node.data {
                NodeData::Text { ref contents } => Some(contents),
                _ => None,
            })
            .fold(StrWrap::new(), |mut acc, contents| {
                acc.push_tendril(contents);
                acc
            });

        into_tendril(text)
    }

    /// Traverses the tree and counts all text content of a node and its descendants,
    /// but only counting each sequence of whitespace as a single character.
    ///
    /// # Arguments
    ///
    /// - `nodes`: a reference to a vector of `TreeNode`s.
    /// - `id`: `NodeId` of the element to get the text content from.
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
    pub fn normalized_char_count(nodes: Ref<Vec<TreeNode>>, id: NodeId) -> usize {
        let mut c: usize = 0;
        let mut last_was_whitespace = true;

        let node_ids = std::iter::once(id).chain(descendant_nodes(Ref::clone(&nodes), &id));
        for node in node_ids.filter_map(|node_id| nodes.get(node_id.value)) {
            if let NodeData::Text { ref contents } = node.data {
                c += normalized_char_count(contents, last_was_whitespace);
                last_was_whitespace = contents.ends_with(char::is_whitespace);
            }
        }

        if last_was_whitespace && c > 0 {
            c -= 1;
        }
        c
    }

    /// Returns the text of the node without its descendants.
    pub fn immediate_text_of(nodes: Ref<Vec<TreeNode>>, id: NodeId) -> StrTendril {
        let mut text = StrWrap::new();

        let node_ids = std::iter::once(id)
            .chain(child_nodes(Ref::clone(&nodes), &id, false));

        node_ids
            .filter_map(|id| nodes.get(id.value))
            .for_each(|tree_node| {
                if let NodeData::Text { ref contents } = tree_node.data {
                    text.push_tendril(contents)
                }
            });

        into_tendril(text)
    }

    /// Gets the last sibling node of a node by id.
    ///
    /// This function walks through sibling nodes from the given node until there are no more sibling nodes.
    /// It returns the last sibling node id it found.
    pub fn last_sibling_of(nodes: &[TreeNode], id: &NodeId) -> Option<NodeId> {
        let mut last_id = None;
        let mut current_id = nodes.get(id.value)?.next_sibling;
        while let Some(curr) = current_id.and_then(|id| nodes.get(id.value)) {
            last_id = Some(curr.id);
            current_id = curr.next_sibling;
        }
        last_id
    }

    /// Returns the next sibling id, that is an [`NodeData::Element`] of the selected node.
    pub fn next_element_sibling_of(nodes: &[TreeNode], id: &NodeId) -> Option<NodeId> {
        let mut node = nodes.get(id.value)?;

        while let Some(id) = node.next_sibling {
            node = nodes.get(id.value)?;
            if node.is_element() {
                return Some(node.id);
            }
        }
        None
    }

    /// Returns the previous sibling id, that is an [`NodeData::Element`] of the selected node.
    pub fn prev_element_sibling_of(nodes: &[TreeNode], id: &NodeId) -> Option<NodeId> {
        let mut node = nodes.get(id.value)?;

        while let Some(id) = node.prev_sibling {
            node = nodes.get(id.value)?;
            if node.is_element() {
                return Some(node.id);
            }
        }
        None
    }

    /// Returns the first child id, that is an [`NodeData::Element`] of the selected node.
    pub fn first_element_child_of(nodes: &[TreeNode], id: &NodeId) -> Option<NodeId> {
        let node = nodes.get(id.value)?;
        let mut next_child_id = node.first_child;

        while let Some(node_id) = next_child_id {
            let child_node = nodes.get(node_id.value)?;
            if child_node.is_element() {
                return Some(node_id);
            }
            next_child_id = child_node.next_sibling;
        }
        None
    }
    /// Checks if the given node id is valid in the tree.
    pub fn is_valid_node_id(nodes: &[TreeNode], id: &NodeId) -> bool {
        nodes.get(id.value).is_some_and(|node| node.id == *id)
    }
}

// manipulation
impl TreeNodeOps {
    /// Creates a new node with the given data.
    pub fn create_node(nodes: &mut Vec<TreeNode>, data: NodeData) -> NodeId {
        let new_child_id = NodeId::new(nodes.len());
        nodes.push(TreeNode::new(new_child_id, data));
        new_child_id
    }

    /// Creates a new element from data  and appends it to a node by id
    pub fn append_child_data_of(nodes: &mut Vec<TreeNode>, id: &NodeId, data: NodeData) {
        let last_child_id = nodes.get(id.value).and_then(|node| node.last_child);

        let new_child_id = NodeId::new(nodes.len());
        let mut child = TreeNode::new(new_child_id, data);
        child.prev_sibling = last_child_id;
        child.parent = Some(*id);
        nodes.push(child);
        let new_child_id_opt = Some(new_child_id);

        if let Some(node) = last_child_id.and_then(|id| nodes.get_mut(id.value)) {
            node.next_sibling = new_child_id_opt
        }

        if let Some(parent) = nodes.get_mut(id.value) {
            if parent.first_child.is_none() {
                parent.first_child = new_child_id_opt
            }
            parent.last_child = new_child_id_opt;
        }
    }

    /// Appends a child node by `new_child_id` to a node by `id`. `new_child_id` must exist in the tree.
    pub fn append_child_of(nodes: &mut [TreeNode], id: &NodeId, new_child_id: &NodeId) {
        Self::remove_from_parent(nodes, new_child_id);
        let Some(parent) = nodes.get_mut(id.value) else {
            return;
        };

        let last_child_id = parent.last_child;

        if last_child_id.is_none() {
            parent.first_child = Some(*new_child_id);
        }

        parent.last_child = Some(*new_child_id);

        if let Some(last_child) = last_child_id.and_then(|id| nodes.get_mut(id.value)) {
            last_child.next_sibling = Some(*new_child_id);
        }

        if let Some(child) = nodes.get_mut(new_child_id.value) {
            child.prev_sibling = last_child_id;
            child.parent = Some(*id);
        }
    }

    /// Prepend a child node by `new_child_id` to a node by `id`. `new_child_id` must exist in the tree.
    pub fn prepend_child_of(nodes: &mut [TreeNode], id: &NodeId, new_child_id: &NodeId) {
        Self::remove_from_parent(nodes, new_child_id);
        let Some(parent) = nodes.get_mut(id.value) else {
            return;
        };
        let first_child_id = parent.first_child;

        if first_child_id.is_none() {
            parent.last_child = Some(*new_child_id);
        }

        parent.first_child = Some(*new_child_id);

        if let Some(first_child) = first_child_id.and_then(|id| nodes.get_mut(id.value)) {
            first_child.prev_sibling = Some(*new_child_id);
        }

        if let Some(child) = nodes.get_mut(new_child_id.value) {
            child.next_sibling = first_child_id;
            child.parent = Some(*id);
            child.prev_sibling = None;
        }
    }

    /// Append a sibling node in the tree before the given node.
    pub fn insert_before_of(nodes: &mut [TreeNode], id: &NodeId, new_sibling_id: &NodeId) {
        Self::remove_from_parent(nodes, new_sibling_id);
        let Some(node) = nodes.get_mut(id.value) else {
            return;
        };

        let parent_id = node.parent;
        let prev_sibling_id = node.prev_sibling;

        node.prev_sibling = Some(*new_sibling_id);

        if let Some(new_sibling) = nodes.get_mut(new_sibling_id.value) {
            new_sibling.parent = parent_id;
            new_sibling.prev_sibling = prev_sibling_id;
            new_sibling.next_sibling = Some(*id);
        };

        if let Some(parent) = parent_id.and_then(|id| nodes.get_mut(id.value)) {
            if parent.first_child == Some(*id) {
                parent.first_child = Some(*new_sibling_id);
            }
        }

        if let Some(prev_sibling) = prev_sibling_id.and_then(|id| nodes.get_mut(id.value)) {
            prev_sibling.next_sibling = Some(*new_sibling_id);
        }
    }

    /// Append a sibling node in the tree after the given node.
    pub fn insert_after_of(nodes: &mut [TreeNode], id: &NodeId, new_sibling_id: &NodeId) {
        Self::remove_from_parent(nodes, new_sibling_id);
        let Some(node) = nodes.get_mut(id.value) else {
            return;
        };

        let parent_id = node.parent;
        let next_sibling_id = node.next_sibling;

        node.next_sibling = Some(*new_sibling_id);

        if let Some(new_sibling) = nodes.get_mut(new_sibling_id.value) {
            new_sibling.parent = parent_id;
            new_sibling.prev_sibling = Some(*id);
            new_sibling.next_sibling = next_sibling_id;
        };

        if let Some(parent) = parent_id.and_then(|id| nodes.get_mut(id.value)) {
            if parent.last_child == Some(*id) {
                parent.last_child = Some(*new_sibling_id);
            }
        }

        if let Some(next_sibling) = next_sibling_id.and_then(|id| nodes.get_mut(id.value)) {
            next_sibling.prev_sibling = Some(*new_sibling_id);
        }
    }

    /// Inserts a node and it's siblings by id before the selected node.
    pub fn insert_siblings_before(nodes: &mut [TreeNode], id: &NodeId, new_node_id: &NodeId) {
        let mut next_node_id = Some(*new_node_id);

        while let Some(node_id) = next_node_id {
            next_node_id = nodes.get(node_id.value).and_then(|n| n.next_sibling);
            Self::insert_before_of(nodes, id, &node_id);
        }
    }

    /// Inserts a node and it's siblings by id after the selected node.
    pub fn insert_siblings_after(nodes: &mut [TreeNode], id: &NodeId, new_node_id: &NodeId) {
        let mut next_node_id = Some(*new_node_id);
        let mut target_id = *id;

        while let Some(node_id) = next_node_id {
            next_node_id = nodes.get(node_id.value).and_then(|n| n.next_sibling);
            Self::insert_after_of(nodes, &target_id, &node_id);
            target_id = node_id;
        }
    }

    /// Appends another node and it's siblings to the selected node.
    pub fn append_children_of(nodes: &mut [TreeNode], id: &NodeId, new_child_id: &NodeId) {
        let mut next_node_id = Some(new_child_id).copied();

        while let Some(node_id) = next_node_id {
            next_node_id = nodes.get(node_id.value).and_then(|n| n.next_sibling);
            Self::append_child_of(nodes, id, &node_id);
        }
    }

    /// Prepend another node and it's siblings to the selected node.
    pub fn prepend_children_of(nodes: &mut [TreeNode], id: &NodeId, new_child_id: &NodeId) {
        // avoiding call borrow
        let mut prev_node_id = Self::last_sibling_of(nodes, new_child_id);

        if prev_node_id.is_none() {
            prev_node_id = Some(*new_child_id)
        }
        while let Some(node_id) = prev_node_id {
            prev_node_id = nodes.get(node_id.value).and_then(|n| n.prev_sibling);
            Self::remove_from_parent(nodes, &node_id);
            Self::prepend_child_of(nodes, id, &node_id);
        }
    }

    /// Remove a node from the its parent by id. The node remains in the tree.
    /// It is possible to assign it to another node in the tree after this operation.
    pub fn remove_from_parent(nodes: &mut [TreeNode], id: &NodeId) {
        let Some(node) = nodes.get_mut(id.value) else {
            return;
        };
        let parent_id = node.parent;
        let prev_sibling_id = node.prev_sibling;
        let next_sibling_id = node.next_sibling;

        if parent_id.is_none() && prev_sibling_id.is_none() && next_sibling_id.is_none() {
            return;
        }

        node.parent = None;
        node.next_sibling = None;
        node.prev_sibling = None;

        if let Some(parent) = parent_id.and_then(|id| nodes.get_mut(id.value)) {
            if parent.first_child == Some(*id) {
                parent.first_child = next_sibling_id;
            }

            if parent.last_child == Some(*id) {
                parent.last_child = prev_sibling_id;
            }
        }

        if let Some(prev_sibling) = prev_sibling_id.and_then(|id| nodes.get_mut(id.value)) {
            prev_sibling.next_sibling = next_sibling_id;
        }

        if let Some(next_sibling) = next_sibling_id.and_then(|id| nodes.get_mut(id.value)) {
            next_sibling.prev_sibling = prev_sibling_id;
        }
    }

    /// Changes the parent of children nodes of a node.
    pub fn reparent_children_of(
        nodes: &mut [TreeNode],
        id: &NodeId,
        new_parent_id: Option<NodeId>,
    ) {
        let Some(node) = nodes.get_mut(id.value) else {
            return;
        };

        let first_child_id = node.first_child;
        let last_child_id = node.last_child;
        node.first_child = None;
        node.last_child = None;

        if let Some(new_parent) = new_parent_id.and_then(|id| nodes.get_mut(id.value)) {
            new_parent.first_child = first_child_id;
            new_parent.last_child = last_child_id;
        }
        let mut next_child_id = first_child_id;
        while let Some(child_id) = next_child_id {
            if let Some(child) = nodes.get_mut(child_id.value) {
                child.parent = new_parent_id;
                next_child_id = child.next_sibling;
            }
        }
    }

    /// Parses given text and sets its contents to the selected node.
    /// This operation replaces any contents of the selected node with the given text.
    pub fn set_text<T>(nodes: &mut Vec<TreeNode>, id: &NodeId, text: T)
    where
        T: Into<StrTendril>,
    {
        let Some(node) = nodes.get_mut(id.value) else {
            return;
        };
        match node.data {
            NodeData::Element(_) => {
                let text_node_id = Self::create_node(
                    nodes,
                    NodeData::Text {
                        contents: wrap_tendril(text.into()),
                    },
                );
                Self::reparent_children_of(nodes, id, None);
                Self::append_child_of(nodes, id, &text_node_id);
            }
            NodeData::Text { ref mut contents } => {
                *contents = wrap_tendril(text.into());
            }
            _ => (),
        }
    }
}

impl TreeNodeOps {
    /// Adds nodes from another tree to the current tree
    pub(crate) fn merge(nodes: &mut Vec<TreeNode>, mut other_nodes: Vec<TreeNode>) {
        // `parse_fragment` returns a document that looks like:
        // <:root>                 id -> 0
        //     <html>              id -> 2
        //        things we need.
        //     </html>
        // <:root>
        // <body></body>           id -> 1

        let offset = nodes.len();
        let id_offset = offset - SKIP_NODES_ON_MERGE;

        for node in other_nodes.iter_mut().skip(SKIP_NODES_ON_MERGE) {
            node.adjust(id_offset);
        }
        nodes.extend(other_nodes.into_iter().skip(SKIP_NODES_ON_MERGE));
    }

    /// Adds nodes from another tree to the current tree and
    /// then applies a function to the first non-document merged node.
    pub(crate) fn merge_with_fn<F>(nodes: &mut Vec<TreeNode>, other: Tree, f: F)
    where
        F: FnOnce(&mut Vec<TreeNode>, NodeId),
    {
        let anchor = nodes.len();
        if anchor < SKIP_NODES_ON_MERGE {
            return;
        }
        let other_nodes = other.nodes.into_inner();
        Self::merge(nodes, other_nodes);
        let new_node_id = NodeId::new(anchor);
        f(nodes, new_node_id);
    }
}
