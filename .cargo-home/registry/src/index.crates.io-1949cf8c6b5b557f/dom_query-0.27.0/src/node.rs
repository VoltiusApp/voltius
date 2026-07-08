mod id_provider;
mod inner;
mod iters;
mod node_data;
mod node_ref;
mod selector;
mod serializing;
mod text_formatting;

use std::fmt::Debug;

pub use id_provider::NodeIdProver;
pub use inner::TreeNode;
pub use iters::{
    ancestor_nodes, child_nodes, descendant_nodes, AncestorNodes, ChildNodes, DescendantNodes,
};
pub use node_data::{Element, NodeData};
pub use node_ref::{Node, NodeRef};
pub use serializing::SerializableNodeRef;
pub(crate) use serializing::SerializeOp;
pub(crate) use text_formatting::format_text;

/// Represents a Node ID.
#[derive(Copy, Debug, Clone, Eq, PartialEq, Hash, Ord, PartialOrd)]
pub struct NodeId {
    pub(crate) value: usize,
}

impl NodeId {
    pub(crate) fn new(value: usize) -> Self {
        NodeId { value }
    }
}
