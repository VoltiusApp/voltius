use std::cell::Ref;

use super::parser::parse_selector_list;
use super::selector::{Combinator, MiniSelector};
use crate::node::{child_nodes, NodeId, NodeRef, TreeNode};

fn collect_matching_descendants<'a>(
    nodes: &Ref<'a, Vec<TreeNode>>,
    current_node_id: &NodeId,
    selector: &MiniSelector,
    is_last_selector: bool,
    results: &mut Vec<NodeId>,
) {
    // Iterate over the direct child nodes
    for child_id in child_nodes(Ref::clone(nodes), current_node_id, false)
        .filter(|id| nodes[id.value].is_element())
    {
        let tree_node = &nodes[child_id.value];
        let matched = selector.match_tree_node(tree_node);

        if matched {
            results.push(child_id);
        }

        // Continue the recursive search only if:
        // 1. The node does NOT match the selector.
        // 2. OR this is the last selector in the path (e.g., 'p' in 'div p').
        if !matched || is_last_selector {
            collect_matching_descendants(nodes, &child_id, selector, is_last_selector, results);
        }
    }
}

fn find_descendants<'a, 'b>(
    node: &'b NodeRef,
    path: &'a str,
) -> Result<Vec<NodeRef<'b>>, nom::Err<nom::error::Error<&'a str>>> {
    let tree = node.tree;
    let nodes = tree.nodes.borrow();
    // Start with the provided node ID as the initial working set
    let mut stack = vec![node.id];

    // Parse the CSS selector list and process each selector sequentially
    let (_, selectors) = parse_selector_list(path)?;
    for (idx, sel) in selectors.iter().enumerate() {
        let is_last = selectors.len() - 1 == idx;
        let mut new_stack = vec![];

        match sel.combinator {
            Combinator::Descendant => {
                for node_id in stack.iter() {
                    collect_matching_descendants(&nodes, node_id, sel, is_last, &mut new_stack);
                }
            }
            Combinator::Child => {
                for node_id in stack.iter() {
                    let matched_nodes = child_nodes(Ref::clone(&nodes), node_id, false)
                        .filter_map(|id| nodes.get(id.value))
                        .filter(|t| t.is_element() && sel.match_tree_node(t))
                        .map(|t| t.id);
                    new_stack.extend(matched_nodes);
                }
            }
            Combinator::Adjacent => {
                for node_id in stack.iter() {
                    let node = NodeRef::new(*node_id, tree);
                    if let Some(next_sibling) = node.next_element_sibling() {
                        if sel.match_node(&next_sibling) {
                            new_stack.push(next_sibling.id);
                        }
                    }
                }
            }
            Combinator::Sibling => {
                for node_id in stack.iter() {
                    let node = NodeRef::new(*node_id, tree);
                    let mut next_sibling = node.next_element_sibling();
                    while let Some(next) = next_sibling {
                        next_sibling = next.next_element_sibling();
                        if sel.match_node(&next) {
                            new_stack.push(next.id);
                        }
                    }
                }
            }
        }
        stack = new_stack;
    }
    Ok(stack
        .into_iter()
        .map(|node_id| NodeRef::new(node_id, tree))
        .collect())
}

impl NodeRef<'_> {
    /// Finds all descendant elements of this node that match the given CSS selector.
    ///
    /// The method returns a vector of descendant `NodeRef` elements that match the selector.
    /// The elements are returned in the order they appear in the document tree.
    /// This method uses [`MiniSelector`] for matching elements—please note its limitations.
    ///
    /// # Experimental
    /// This method is experimental and may change in the future.
    ///
    /// # Arguments
    ///
    /// * `css_path` - The CSS selector used to match descendant elements.
    ///
    /// # Returns
    ///
    /// A vector of descendant `NodeRef` elements matching the selector.
    pub fn find_descendants(&self, css_path: &str) -> Vec<NodeRef<'_>> {
        self.try_find_descendants(css_path).unwrap_or_default()
    }

    /// Finds all descendant elements of this node that match the given CSS selector.
    ///
    /// The method returns a vector of descendant `NodeRef` elements that match the selector.
    /// The elements are returned in the order they appear in the document tree.
    /// This method uses [`MiniSelector`] for matching elements—please note its limitations.
    ///
    /// # Experimental
    /// This method is experimental and may change in the future.
    ///
    /// # Arguments
    ///
    /// * `css_path` - The CSS selector used to match descendant elements.
    ///
    /// # Returns
    ///
    /// A vector of descendant `NodeRef` elements matching the selector.
    ///
    /// # Errors
    ///
    /// Returns an error if the CSS selector is invalid.
    pub fn try_find_descendants<'a>(
        &self,
        css_path: &'a str,
    ) -> Result<Vec<NodeRef<'_>>, nom::Err<nom::error::Error<&'a str>>> {
        find_descendants(self, css_path)
    }

    /// Checks if this node matches the given CSS selector.
    ///
    /// This method uses [`MiniSelector`] for matching elements—please note its limitations.
    /// It is faster than [`NodeRef::is`] method but has limitations.
    ///
    /// # Arguments
    ///
    /// * `css_sel` - The CSS selector used to match this node.
    ///
    /// # Returns
    ///
    /// `true` if this node matches the given CSS selector, `false` otherwise.
    pub fn mini_is(&self, css_sel: &str) -> bool {
        MiniSelector::new(css_sel).is_ok_and(|sel| self.mini_match(&sel))
    }

    /// Checks if this node matches the given CSS selector.
    ///
    /// This method uses the given [`MiniSelector`] for matching elements.
    /// It is faster than [`NodeRef::is_match`] method but has limitations.
    ///
    /// # Arguments
    ///
    /// * `matcher` - The `MiniSelector` used to match this node.
    ///
    /// # Returns
    ///
    /// `true` if this node matches the given CSS selector, `false` otherwise.
    pub fn mini_match(&self, matcher: &MiniSelector) -> bool {
        matcher.match_node(self)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Document, NodeId};

    #[cfg(target_arch = "wasm32")]
    use wasm_bindgen_test::*;

    #[cfg(target_arch = "wasm32")]
    #[global_allocator]
    pub static ALLOC: &alloc_cat::AllocCat = &alloc_cat::ALLOCATOR;

    #[test]
    fn test_names() {
        let sel = r#"body td a"#;
        let parsed = parse_selector_list(sel).unwrap();
        assert_eq!(parsed.1.len(), 3);
    }

    #[cfg_attr(not(target_arch = "wasm32"), test)]
    #[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
    fn test_node_find_descendants() {
        let html_contents = include_str!("../../test-pages/hacker_news.html");
        let doc = Document::from(html_contents);
        let a_sel = doc.select(r#"body td.title a[href^="https://"]"#);
        let expected_ids: Vec<NodeId> = a_sel.nodes().iter().map(|n| n.id).collect();

        let root = doc.root();
        let got_ids: Vec<NodeId> = root
            .find_descendants(r#"body td.title a[href^="https://"]"#)
            .iter()
            .map(|n| n.id)
            .collect();

        assert_eq!(got_ids, expected_ids);

        let a_sel = doc.select("a");
        let expected_ids: Vec<NodeId> = a_sel.nodes().iter().map(|n| n.id).collect();
        let got_ids_a: Vec<NodeId> = root.find_descendants("a").iter().map(|n| n.id).collect();
        assert_eq!(got_ids_a, expected_ids);

        let len_fin_ne = root.find_descendants("body td p").len();
        assert_eq!(len_fin_ne, 0);
        let len_sel_ne = doc.select("body td p").length();
        assert_eq!(len_sel_ne, 0)
    }

    #[cfg_attr(not(target_arch = "wasm32"), test)]
    #[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
    fn test_node_find_descendant_combinators() {
        let html_contents = include_str!("../../test-pages/hacker_news.html");
        let doc = Document::from(html_contents);
        let selectors = [
            "body td.title a",
            "body td.title > a",
            "body td.title a + span",
            "body td.title a ~ span",
            "body tr td a",
            "body td a[href]",
        ];

        for sel in selectors {
            let a_sel = doc.select(sel);
            let expected_ids: Vec<NodeId> = a_sel.nodes().iter().map(|n| n.id).collect();
            let root = doc.root();
            let got_ids: Vec<NodeId> = root.find_descendants(sel).iter().map(|n| n.id).collect();
            assert_eq!(got_ids, expected_ids);
        }
    }

    #[cfg_attr(not(target_arch = "wasm32"), test)]
    #[cfg_attr(target_arch = "wasm32", wasm_bindgen_test)]
    fn test_node_snap_match() {
        let contents = r#"<div>
            <a id="main-link" class="link text-center bg-blue-400 border" href="https://example.com/main-page/" target>Example</a>
            <a class="other-link" href="https://example.com/another-page/">Another Example</a>
        </div>"#;
        let doc = Document::fragment(contents);
        let link_sel = doc.select_single(r#"a[id]"#);
        let link_node = link_sel.nodes().first().unwrap();
        assert!(!link_node.mini_is(r#"a[href="//example.com"]"#));
        assert!(link_node.mini_is(r#"a[href^="https://"]"#));
        assert!(link_node.mini_is(r#"a[href$="/"]"#));
        assert!(link_node.mini_is(r#"a[href*="example.com"]"#));
        assert!(link_node.mini_is(r#"a[id|="main"]"#));
        assert!(link_node.mini_is(r#"a[class~="border"]"#));
        assert!(link_node.mini_is(r#"[class *= "blue-400 bord"]"#));
        assert!(!link_node.mini_is(r#"[class *= "glue-400 bord"]"#));
        assert!(link_node.mini_is(r#"#main-link"#));
        assert!(!link_node.mini_is(r#"#link"#));
        assert!(!link_node.mini_is(r#"a[target="_blank"]"#));
        assert!(link_node.mini_is(r#"a[target]"#));
        assert!(!link_node.mini_is(r#"a[href^="https://"][href*="examplxe"][href$="/"]"#));
        assert!(link_node.mini_is(r#"a[href^="https://"][href*="example"][href$="/"]"#));

        let another_sel = doc.select_single(r#"a.other-link"#);
        let another_link_node = another_sel.nodes().first().unwrap();
        let text_node = another_link_node.first_child().unwrap();

        assert!(!another_link_node.mini_is(r#"#main-link"#));
        assert!(!text_node.mini_is(r#"#main-link"#));
    }
}
