// Validation methods
use super::tree::Tree;

impl Tree {
    /// Validates the structural integrity of the tree.
    ///
    /// This function checks for:
    ///
    /// 1. **Root Uniqueness**:
    ///    - Ensures exactly one root node exists (`parent == None`) and it is `NodeId(0)`.
    ///
    /// 2. **Parent-Child Link Consistency**:
    ///    - `first_child.parent == Self`
    ///    - `first_child.prev_sibling == None`
    ///    - `last_child.parent == Self`
    ///    - `last_child.next_sibling == None`
    ///    - All children in the chain from `first_child` to `last_child` have correct `parent`, `prev_sibling`, and `next_sibling` references.
    ///
    /// 3. **Sibling Link Consistency**:
    ///    - `prev_sibling.next_sibling == Self`
    ///    - `next_sibling.prev_sibling == Self`
    ///
    /// 4. **Valid Node References**:
    ///    - All `NodeId` references must point to valid nodes within the tree.
    ///
    ///
    /// 5. **Cycle Detection**:
    ///    - No cycles in parent chains (traverse `parent` links).
    ///    - No cycles in sibling chains (traverse `next_sibling` links).
    ///
    /// Returns:
    /// - `Ok(())` if the tree structure is valid.
    /// - `Err(String)` with a descriptive message if any inconsistency or cycle is detected.
    ///
    /// Orphaned nodes (non-root nodes with `parent == None`) are allowed and not considered invalid.
    pub fn validate(&self) -> Result<(), String> {
        let nodes = self.nodes.borrow();

        // Root uniqueness check
        let root_node = nodes
            .first()
            .ok_or_else(|| "Root node (NodeId(0)) missing".to_string())?;
        if root_node.parent.is_some() {
            return Err("Root node (NodeId(0)) must have no parent".to_string());
        }

        // Node parent-child / sibling link consistency checks
        for node in nodes.iter() {
            let id = node.id;

            // Validate self-cycles
            if node.parent == Some(id) {
                return Err(format!("Node {id:?} references itself as parent"));
            }
            if node.prev_sibling == Some(id) {
                return Err(format!("Node {id:?} references itself as prev_sibling"));
            }
            if node.next_sibling == Some(id) {
                return Err(format!("Node {id:?} references itself as next_sibling"));
            }
            if node.first_child == Some(id) {
                return Err(format!("Node {id:?} references itself as first_child"));
            }
            if node.last_child == Some(id) {
                return Err(format!("Node {id:?} references itself as last_child"));
            }

            // Validate first_child linkage
            if let Some(first_child_id) = node.first_child {
                let first_child = nodes.get(first_child_id.value).ok_or_else(|| {
                    format!("Invalid first_child {first_child_id:?} reference at node {id:?}")
                })?;

                if first_child.parent != Some(id) {
                    return Err(format!("first_child's parent does not match node {id:?}"));
                }

                if first_child.prev_sibling.is_some() {
                    return Err(format!(
                        "first_child {first_child_id:?} of node {id:?} has non-None prev_sibling"
                    ));
                }

                // Validate child chain
                let mut current_id = Some(first_child_id);
                let mut last_seen = None;
                while let Some(cid) = current_id {
                    let current = nodes
                        .get(cid.value)
                        .ok_or_else(|| format!("Invalid child reference at node {cid:?}"))?;

                    if current.parent != Some(id) {
                        return Err(format!(
                            "Child {cid:?} has incorrect parent, expected {id:?}"
                        ));
                    }

                    if let Some(prev) = current.prev_sibling {
                        let prev_node = nodes.get(prev.value).ok_or_else(|| {
                            format!("Invalid prev_sibling reference at node {prev:?}")
                        })?;
                        if prev_node.next_sibling != Some(cid) {
                            return Err(format!(
                                "prev_sibling {prev:?} next_sibling mismatch with {cid:?}"
                            ));
                        }
                    }

                    if let Some(next) = current.next_sibling {
                        let next_node = nodes.get(next.value).ok_or_else(|| {
                            format!("Invalid next_sibling reference at node {next:?}")
                        })?;
                        if next_node.prev_sibling != Some(cid) {
                            return Err(format!(
                                "next_sibling {next:?} prev_sibling mismatch with {cid:?}"
                            ));
                        }
                        current_id = Some(next);
                    } else {
                        last_seen = Some(cid);
                        current_id = None;
                    }
                }

                if node.last_child != last_seen {
                    return Err(format!(
                        "last_child mismatch at node {:?}, expected {:?}, found {:?}",
                        id, node.last_child, last_seen
                    ));
                }
            }

            // Validate last_child linkage
            if let Some(last_child_id) = node.last_child {
                let last_child = nodes
                    .get(last_child_id.value)
                    .ok_or_else(|| format!("Invalid last_child reference at node {id:?}"))?;

                if last_child.parent != Some(id) {
                    return Err(format!("last_child's parent does not match node {id:?}"));
                }

                if last_child.next_sibling.is_some() {
                    return Err(format!(
                        "last_child {last_child_id:?} of node {id:?} has non-None next_sibling"
                    ));
                }
            }

            // Validate sibling links
            if let Some(prev_sibling_id) = node.prev_sibling {
                let prev_sibling = nodes
                    .get(prev_sibling_id.value)
                    .ok_or_else(|| format!("Invalid prev_sibling reference at node {id:?}"))?;

                if prev_sibling.next_sibling != Some(id) {
                    return Err(format!(
                        "prev_sibling {prev_sibling_id:?} does not link back to {id:?}",
                    ));
                }
            }

            if let Some(next_sibling_id) = node.next_sibling {
                let next_sibling = nodes
                    .get(next_sibling_id.value)
                    .ok_or_else(|| format!("Invalid next_sibling reference at node {id:?}"))?;

                if next_sibling.prev_sibling != Some(id) {
                    return Err(format!(
                        "next_sibling {next_sibling_id:?} does not link back to {id:?}"
                    ));
                }
            }
        }

        // Cycle detection: Parent chains
        for node in nodes.iter() {
            let mut visited = std::collections::HashSet::new();
            let mut current = Some(node.id);
            while let Some(cid) = current {
                if !visited.insert(cid.value) {
                    return Err(format!("Cycle detected in parent chain at node {cid:?}"));
                }
                current = nodes.get(cid.value).and_then(|n| n.parent);
            }
        }

        // Cycle detection: Sibling chains
        for node in nodes.iter() {
            if let Some(first_child_id) = node.first_child {
                let mut visited = std::collections::HashSet::new();
                let mut current = Some(first_child_id);
                while let Some(cid) = current {
                    if !visited.insert(cid.value) {
                        return Err(format!("Cycle detected in sibling chain at node {cid:?}"));
                    }
                    current = nodes.get(cid.value).and_then(|n| n.next_sibling);
                }
            }
        }

        Ok(())
    }
}
