//! HTML manipulation with CSS selectors.
//!
//! # Features
//!
//! - Parse HTML documents and fragments
//! - Query DOM elements using CSS selectors
//! - Traverse the DOM tree (ancestors, parents, children, siblings)
//! - Manipulate elements and their attributes:
//!   - Add/remove/modify attributes
//!   - Change element content
//!   - Add/remove elements
//!   - Rename elements
//!   - Move elements within the DOM tree
//!

#![doc= include_str!("../Examples.md")]

mod css;
mod document;
mod dom_tree;
mod entities;
mod matcher;
mod node;
mod selection;

pub mod serializing;

#[cfg(feature = "mini_selector")]
pub mod mini_selector;

pub use document::Document;
pub use dom_tree::Tree;
pub use dom_tree::TreeNodeOps;
pub use entities::Attr;
pub use matcher::Matcher;
#[doc(hidden)]
pub use node::SerializableNodeRef;
pub use node::{Element, Node, NodeData, NodeId, NodeIdProver, NodeRef, TreeNode};
pub use selection::Selection;

// re-export
pub use html5ever::{local_name, LocalName};
