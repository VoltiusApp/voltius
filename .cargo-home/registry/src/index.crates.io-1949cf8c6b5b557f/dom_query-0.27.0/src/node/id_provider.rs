use super::{node_ref::NodeRef, NodeId};

/// A trait that provides the [`NodeId`]
pub trait NodeIdProver {
    /// Returns the [`NodeId`]
    fn node_id(&self) -> &NodeId;
}

impl NodeIdProver for &NodeRef<'_> {
    fn node_id(&self) -> &NodeId {
        &self.id
    }
}

impl NodeIdProver for &NodeId {
    fn node_id(&self) -> Self {
        self
    }
}
