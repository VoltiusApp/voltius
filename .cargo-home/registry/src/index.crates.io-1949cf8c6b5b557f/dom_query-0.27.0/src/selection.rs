use std::cell::Ref;
use std::ops::Deref;
use std::vec::IntoIter;

use html5ever::Attribute;
use tendril::StrTendril;

use crate::document::Document;
use crate::matcher::{DescendantMatches, Matcher, Matches};
use crate::node::{ancestor_nodes, child_nodes, format_text, NodeId, NodeRef, TreeNode};
use crate::{Tree, TreeNodeOps};

/// Selection represents a collection of nodes matching some criteria. The
/// initial Selection object can be created by using [`Document::select`], and then
/// manipulated using methods itself.
#[derive(Debug, Clone, Default)]
pub struct Selection<'a> {
    pub(crate) nodes: Vec<NodeRef<'a>>,
}

impl<'a> From<NodeRef<'a>> for Selection<'a> {
    fn from(node: NodeRef<'a>) -> Selection<'a> {
        Self { nodes: vec![node] }
    }
}

impl<'a> From<Vec<NodeRef<'a>>> for Selection<'a> {
    fn from(nodes: Vec<NodeRef<'a>>) -> Selection<'a> {
        Self { nodes }
    }
}

// property methods
impl Selection<'_> {
    /// Gets the specified attribute's value for the first element in the
    /// selection. To get the value for each element individually, use a looping
    /// construct such as map method.
    pub fn attr(&self, name: &str) -> Option<StrTendril> {
        self.nodes().first().and_then(|node| node.attr(name))
    }

    /// Gets all attributes` values for the first element in the
    /// selection. To get the value for each element individually, use a looping
    /// construct such as map method.
    pub fn attrs(&self) -> Vec<Attribute> {
        self.nodes()
            .first()
            .map_or_else(Vec::new, |node| node.attrs())
    }

    /// Checks if the first element in the selection has an attribute with the name.
    pub fn has_attr(&self, name: &str) -> bool {
        self.nodes().first().is_some_and(|node| node.has_attr(name))
    }

    /// Works like `attr` but returns default value if attribute is not present.
    pub fn attr_or(&self, name: &str, default: &str) -> StrTendril {
        self.attr(name).unwrap_or_else(|| StrTendril::from(default))
    }

    /// Sets the given attribute to each element in the set of matched elements.
    pub fn set_attr(&self, name: &str, val: &str) {
        self.update_nodes(|tree_node| {
            tree_node.set_attr(name, val);
        });
    }

    /// Removes the named attribute from each element in the set of matched elements.
    pub fn remove_attr(&self, name: &str) {
        self.update_nodes(|tree_node| {
            tree_node.remove_attr(name);
        });
    }

    /// Removes named attributes from each element in the set of matched elements.
    ///
    /// # Arguments
    /// * `names` - A list of attribute names to remove. Empty slice removes no attributes.
    pub fn remove_attrs(&self, names: &[&str]) {
        self.update_nodes(|tree_node| {
            tree_node.remove_attrs(names);
        });
    }

    /// Retains only the attributes with the specified names from each element in the set of matched elements.
    ///
    /// # Arguments
    /// * `names` - A list of attribute names to retain. Empty slice retains no attributes.
    pub fn retain_attrs(&self, names: &[&str]) {
        self.update_nodes(|tree_node| {
            tree_node.retain_attrs(names);
        });
    }

    /// Removes all attributes from each element in the set of matched elements.
    pub fn remove_all_attrs(&self) {
        self.update_nodes(|tree_node| {
            tree_node.remove_all_attrs();
        });
    }

    /// Renames tag of each element in the set of matched elements.
    pub fn rename(&self, name: &str) {
        self.update_nodes(|tree_node| {
            tree_node.rename(name);
        });
    }

    /// Removes matching elements from the descendants, but keeps their children (if any) in the tree.
    ///
    /// Unlike [`Self::remove`], this method only deletes the elements themselves, promoting their children
    /// to the parent level, thus preserving the nested structure of the remaining nodes.
    ///
    /// # Arguments
    /// * `names` - A list of element names to strip.
    pub fn strip_elements(&self, names: &[&str]) {
        self.nodes()
            .iter()
            .for_each(|node| node.strip_elements(names))
    }

    /// Returns the id of the first element in the set of matched elements.
    pub fn id(&self) -> Option<StrTendril> {
        self.nodes().first().and_then(|node| node.id_attr())
    }

    /// Returns the class name of the first element in the set of matched elements.
    pub fn class(&self) -> Option<StrTendril> {
        self.nodes().first().and_then(|node| node.class())
    }

    /// Adds the given class to each element in the set of matched elements.
    /// Multiple class names can be specified, separated by a space via multiple arguments.
    pub fn add_class(&self, class: &str) {
        self.update_nodes(|tree_node| {
            tree_node.add_class(class);
        });
    }

    /// Determines whether any of the matched elements are assigned the
    /// given class.
    pub fn has_class(&self, class: &str) -> bool {
        self.nodes().iter().any(|node| node.has_class(class))
    }

    /// Removes the given class from each element in the set of matched elements.
    /// Multiple class names can be specified, separated by a space via multiple arguments.
    pub fn remove_class(&self, class: &str) {
        self.update_nodes(|tree_node| {
            tree_node.remove_class(class);
        });
    }

    /// Returns the number of elements in the selection object.
    pub fn length(&self) -> usize {
        self.nodes().len()
    }

    /// Is an alias for `length`.
    pub fn size(&self) -> usize {
        self.length()
    }

    /// Is there any matched elements.
    pub fn exists(&self) -> bool {
        self.length() > 0
    }

    // Returns true if there are no elements in the selection object.
    // A common, simple and clear function.
    pub fn is_empty(&self) -> bool {
        self.length() == 0
    }

    /// Gets the HTML contents of the first element in the set of matched
    /// elements. It includes the first matching element and its children nodes.
    pub fn html(&self) -> StrTendril {
        self.nodes
            .first()
            .map_or_else(StrTendril::new, |node| node.html())
    }

    /// Gets the HTML contents of the first element in the set of matched
    /// elements. It includes only children nodes.
    pub fn inner_html(&self) -> StrTendril {
        self.nodes
            .first()
            .map_or_else(StrTendril::new, |node| node.inner_html())
    }

    /// Gets the HTML contents of the first element in the set of matched
    /// elements. It includes the first matching element and its children nodes.
    pub fn try_html(&self) -> Option<StrTendril> {
        self.nodes().first().and_then(|node| node.try_html())
    }

    /// Gets the HTML contents of the first element in the set of matched
    /// elements. It includes only children nodes.
    pub fn try_inner_html(&self) -> Option<StrTendril> {
        self.nodes().first().and_then(|node| node.try_inner_html())
    }

    /// Gets the combined text content of each element in the set of matched
    /// elements, including their descendants.
    pub fn text(&self) -> StrTendril {
        self.text_fn(TreeNodeOps::text_of)
    }

    /// Gets the combined text content of each element in the set of matched, without their descendants.
    pub fn immediate_text(&self) -> StrTendril {
        self.text_fn(TreeNodeOps::immediate_text_of)
    }

    /// Returns the formatted text of the selected nodes and their descendants.
    /// This is the same as the `text()` method, but with a few differences:
    ///
    /// - Whitespace is normalized so that there is only one space between words.
    /// - All whitespace is removed from the beginning and end of the text.
    /// - After block elements, a double newline is added.
    /// - For elements like `br`, 'hr', 'li', 'tr' a single newline is added.
    pub fn formatted_text(&self) -> StrTendril {
        let mut s = StrTendril::new();
        for node in self.nodes() {
            s.push_tendril(&format_text(node, true));
        }
        s
    }
}

//matching methods
impl<'a> Selection<'a> {
    /// Checks the current matched set of elements against a selector and
    /// returns true if at least one of these elements matches.
    pub fn is(&self, sel: &str) -> bool {
        Matcher::new(sel).is_ok_and(|matcher| self.is_matcher(&matcher))
    }

    /// Checks the current matched set of elements against a matcher and
    /// returns true if at least one of these elements matches.
    pub fn is_matcher(&self, matcher: &Matcher) -> bool {
        if self.length() > 0 {
            return self.nodes().iter().any(|node| matcher.match_element(node));
        }
        false
    }

    /// Checks the current matches set of elements against a selection and
    /// returns true if at least one of these elements matches.
    pub fn is_selection(&self, other: &Selection) -> bool {
        if self.is_empty() || other.is_empty() {
            return false;
        }
        let m: Vec<usize> = other.nodes().iter().map(|node| node.id.value).collect();
        self.nodes().iter().any(|node| m.contains(&node.id.value))
    }

    /// Filters the current set of matched elements to those that match the
    /// given CSS selector.
    ///
    /// # Panics
    ///
    /// # Arguments
    ///
    /// * `sel` - The CSS selector to match against.
    ///
    /// # Returns
    ///
    /// A new Selection object containing the matched elements.
    pub fn filter(&self, sel: &str) -> Selection<'a> {
        if self.is_empty() {
            return self.clone();
        }
        let matcher = Matcher::new(sel).expect("Invalid CSS selector");
        self.filter_matcher(&matcher)
    }

    /// Reduces the current set of matched elements to those that match the
    /// given CSS selector.
    ///
    /// # Arguments
    ///
    /// * `sel` - The CSS selector to match against.
    ///
    /// # Returns
    ///
    ///  `None` if the selector was invalid, otherwise a new `Selection` object containing the matched elements.
    pub fn try_filter(&self, sel: &str) -> Option<Selection<'a>> {
        if self.is_empty() {
            return Some(self.clone());
        }
        Matcher::new(sel).ok().map(|m| self.filter_matcher(&m))
    }

    /// Reduces the current set of matched elements to those that match the
    /// given matcher.
    ///
    /// # Arguments
    ///
    /// * `matcher` - The matcher to match against.
    ///
    /// # Returns
    ///
    /// A new Selection object containing the matched elements.
    pub fn filter_matcher(&self, matcher: &Matcher) -> Selection<'a> {
        if self.is_empty() {
            return self.clone();
        }
        let nodes = self
            .nodes()
            .iter()
            .filter(|&node| matcher.match_element(node))
            .cloned()
            .collect();
        Selection { nodes }
    }

    /// Reduces the set of matched elements to those that match a node in the specified `Selection`.
    /// It returns a new `Selection` for this subset of elements.
    pub fn filter_selection(&self, other: &Selection) -> Selection<'a> {
        if self.is_empty() || other.is_empty() {
            return self.clone();
        }
        let m: Vec<usize> = other.nodes().iter().map(|node| node.id.value).collect();
        let nodes = self
            .nodes()
            .iter()
            .filter(|&node| m.contains(&node.id.value))
            .cloned()
            .collect();
        Selection { nodes }
    }

    /// Adds nodes that match the given CSS selector to the current selection.
    ///
    /// # Panics
    ///
    /// If matcher contains invalid CSS selector it panics.
    ///
    /// # Arguments
    ///
    /// * `sel` - The CSS selector to match against.
    ///
    /// # Returns
    ///
    /// The new `Selection` containing the original nodes and the new nodes.
    pub fn add(&self, sel: &str) -> Selection<'a> {
        if self.is_empty() {
            return self.clone();
        }
        let matcher = Matcher::new(sel).expect("Invalid CSS selector");
        self.add_matcher(&matcher)
    }

    /// Adds nodes that match the given CSS selector to the current selection.
    ///
    /// If matcher contains invalid CSS selector it returns `None`.
    ///
    /// # Arguments
    ///
    /// * `sel` - The CSS selector to match against.
    ///
    /// # Returns
    ///
    /// The new `Selection` containing the original nodes and the new nodes.
    pub fn try_add(&self, sel: &str) -> Option<Selection<'_>> {
        if self.is_empty() {
            return Some(self.clone());
        }
        Matcher::new(sel).ok().map(|m| self.add_matcher(&m))
    }

    /// Adds nodes that match the given matcher to the current selection.
    ///
    /// # Arguments
    ///
    /// * `matcher` - The matcher to match against.
    ///
    /// # Returns
    ///
    /// The new `Selection` containing the original nodes and the new nodes.
    pub fn add_matcher(&self, matcher: &Matcher) -> Selection<'a> {
        if self.is_empty() {
            return self.clone();
        }
        let root = self.nodes().first().unwrap().tree.root();
        let other_nodes = DescendantMatches::new(root, matcher).collect();
        let new_nodes = self.merge_nodes(other_nodes);
        Selection { nodes: new_nodes }
    }

    /// Adds a selection to the current selection.
    ///
    /// Behaves like `Union` for sets.
    ///
    /// # Arguments
    ///
    /// * `other` - The selection to add to the current selection.
    ///
    /// # Returns
    ///
    /// A new `Selection` object containing the combined elements.
    pub fn add_selection(&self, other: &'a Selection) -> Selection<'a> {
        if self.is_empty() {
            return other.clone();
        }

        if other.is_empty() {
            return self.clone();
        }

        self.ensure_same_tree(other);

        let other_nodes = other.nodes();
        let new_nodes = self.merge_nodes(other_nodes.to_vec());

        Selection { nodes: new_nodes }
    }

    fn merge_nodes(&self, other_nodes: Vec<NodeRef<'a>>) -> Vec<NodeRef<'a>> {
        let m: Vec<usize> = self.nodes().iter().map(|node| node.id.value).collect();
        let add_nodes: Vec<NodeRef> = other_nodes
            .iter()
            .filter(|&node| !m.contains(&node.id.value))
            .cloned()
            .collect();

        let mut new_nodes = self.nodes().to_vec();
        new_nodes.extend(add_nodes);
        new_nodes
    }
}

//manipulating methods
impl Selection<'_> {
    /// Removes the set of matched elements from the document.
    pub fn remove(&self) {
        self.update_nodes_by_id(|nodes, id| {
            TreeNodeOps::remove_from_parent(nodes, id);
        });
    }

    /// Replaces each element in the set of matched element with
    /// the nodes from the given selection.
    ///
    /// This follows the same rules as `append`.
    ///
    pub fn replace_with_selection(&self, sel: &Selection) {
        //! Note: goquery's behavior is taken as the basis.
        if sel.is_empty() {
            return;
        }

        self.merge_selection_with_fn(sel, |node, new_node_id| {
            node.insert_before(new_node_id);
        });
        self.remove();
    }

    /// Appends the elements in the selection to the end of each element
    /// in the set of matched elements.
    pub fn append_selection(&self, sel: &Selection) {
        //! Note: goquery's behavior is taken as the basis.
        self.merge_selection_with_fn(sel, |node, new_node_id| node.append_children(new_node_id));
    }

    /// Prepends the elements in the selection to the beginning of each element
    /// in the set of matched elements.
    pub fn prepend_selection(&self, sel: &Selection) {
        //! Note: goquery's behavior is taken as the basis.
        self.merge_selection_with_fn(sel, |node, new_node_id| node.prepend_children(new_node_id));
    }

    fn merge_selection_with_fn<F>(&self, sel: &Selection, f: F)
    where
        F: Fn(&NodeRef, &NodeId),
    {
        //! Note: goquery's behavior is taken as the basis.

        if sel.is_empty() {
            return;
        }
        sel.remove();
        let sel_nodes = sel.nodes();
        for node in self.nodes() {
            node.tree
                .copy_nodes_with_fn(sel_nodes, |new_node_id| f(node, &new_node_id));
        }
    }

    /// Set the html contents of each element in the selection to specified parsed HTML.
    pub fn set_html<T: Into<StrTendril>>(&self, html: T) {
        self.merge_html_with_fn(html, |tree_nodes, new_node_id, node| {
            TreeNodeOps::reparent_children_of(tree_nodes, &node.id, None);
            if TreeNodeOps::is_valid_node_id(tree_nodes, &new_node_id) {
                TreeNodeOps::append_children_of(tree_nodes, &node.id, &new_node_id);
            }
        });
    }

    /// Replaces each element in the set of matched elements with
    /// the parsed HTML.
    ///
    /// This follows the same rules as `append`.
    pub fn replace_with_html<T: Into<StrTendril>>(&self, html: T) {
        self.merge_html_with_fn(html, |tree_nodes, new_node_id, node| {
            if TreeNodeOps::is_valid_node_id(tree_nodes, &new_node_id) {
                TreeNodeOps::insert_siblings_before(tree_nodes, &node.id, &new_node_id);
            }
            TreeNodeOps::remove_from_parent(tree_nodes, &node.id);
        });
    }

    /// Parses the html and appends it to the set of matched elements.
    pub fn append_html<T: Into<StrTendril>>(&self, html: T) {
        self.merge_html_with_fn(html, |tree_nodes, new_node_id, node| {
            if TreeNodeOps::is_valid_node_id(tree_nodes, &new_node_id) {
                TreeNodeOps::append_children_of(tree_nodes, &node.id, &new_node_id);
            }
        });
    }

    /// Parses the html and prepends it to the set of matched elements.
    pub fn prepend_html<T: Into<StrTendril>>(&self, html: T) {
        self.merge_html_with_fn(html, |tree_nodes, new_node_id, node| {
            if TreeNodeOps::is_valid_node_id(tree_nodes, &new_node_id) {
                TreeNodeOps::prepend_children_of(tree_nodes, &node.id, &new_node_id);
            }
        });
    }

    /// Parses the html and inserts it before the set of matched elements.
    pub fn before_html<T: Into<StrTendril>>(&self, html: T) {
        self.merge_html_with_fn(html, |tree_nodes, new_node_id, node| {
            if TreeNodeOps::is_valid_node_id(tree_nodes, &new_node_id) {
                TreeNodeOps::insert_siblings_before(tree_nodes, &node.id, &new_node_id);
            }
        });
    }

    /// Parses the html and inserts it after the set of matched elements.
    pub fn after_html<T: Into<StrTendril>>(&self, html: T) {
        self.merge_html_with_fn(html, |tree_nodes, new_node_id, node| {
            if TreeNodeOps::is_valid_node_id(tree_nodes, &new_node_id) {
                TreeNodeOps::insert_siblings_after(tree_nodes, &node.id, &new_node_id);
            }
        });
    }

    /// Sets the content of each element in the selection to specified content. Doesn't escapes the text.
    ///
    /// If simple text needs to be inserted, this method is preferable to [Selection::set_html],
    /// because it is more lightweight -- it does not create a fragment tree underneath.
    pub fn set_text(&self, text: &str) {
        self.update_nodes_by_id(|nodes, id| {
            TreeNodeOps::set_text(nodes, id, text);
        });
    }
}

// traversing methods
impl<'a> Selection<'a> {
    /// Gets the descendants of each element in the current set of matched
    /// elements, filter by a selector. It returns a new Selection object
    /// containing these matched elements.
    ///
    /// # Panics
    ///
    /// Panics if failed to parse the given CSS selector.
    pub fn select<'b>(&self, sel: &'b str) -> Selection<'a>
    where
        'a: 'b,
    {
        let matcher = Matcher::new(sel).expect("Invalid CSS selector");
        self.select_matcher(&matcher)
    }

    /// Gets the descendants of each element in the current set of matched
    /// elements, filter by a matcher. It returns a new Selection object
    /// containing these matched elements.
    pub fn select_matcher(&self, matcher: &Matcher) -> Selection<'a> {
        if self.is_empty() {
            return Selection::default();
        }
        let nodes = if self.nodes().len() == 1 {
            let root_node = self.nodes()[0];
            DescendantMatches::new(root_node, matcher).collect()
        } else {
            Matches::new(self.nodes.clone().into_iter().rev(), matcher).collect()
        };

        Selection { nodes }
    }

    /// Alias for `select`, it gets the descendants of each element in the current set of matched
    /// elements, filter by a selector. It returns a new Selection object
    /// containing these matched elements.
    ///
    /// # Panics
    ///
    /// Panics if failed to parse the given CSS selector.
    pub fn nip(&self, sel: &'a str) -> Selection<'a> {
        self.select(sel)
    }

    /// Gets the descendants of each element in the current set of matched
    /// elements, filter by a selector. It returns a new Selection object
    /// containing these matched elements.
    pub fn try_select(&self, sel: &str) -> Option<Selection<'a>> {
        Matcher::new(sel).ok().and_then(|matcher| {
            let selection = self.select_matcher(&matcher);
            if selection.is_empty() {
                None
            } else {
                Some(selection)
            }
        })
    }

    /// Gets the descendants of each element in the current set of matched
    /// elements, filter by a matcher. It returns a new Selection object
    /// containing elements of the single (first) match..
    pub fn select_single_matcher(&self, matcher: &Matcher) -> Selection<'a> {
        if self.nodes.is_empty() {
            return Selection::default();
        }
        let node = if self.nodes().len() == 1 {
            DescendantMatches::new(self.nodes()[0], matcher).next()
        } else {
            Matches::new(self.nodes.clone().into_iter().rev(), matcher).next()
        };

        match node {
            Some(node) => Selection { nodes: vec![node] },
            None => Selection::default(),
        }
    }

    /// Gets the descendants of each element in the current set of matched elements, filter by a selector.
    /// It returns a new selection object containing elements of the single (first) match.
    ///
    /// # Panics
    ///
    /// Panics if failed to parse the given CSS selector.
    pub fn select_single(&self, sel: &str) -> Selection<'a> {
        let matcher = Matcher::new(sel).expect("Invalid CSS selector");
        self.select_single_matcher(&matcher)
    }

    /// Returns a slice of underlying nodes.
    pub fn nodes(&self) -> &[NodeRef<'a>] {
        &self.nodes
    }

    /// Creates an iterator over these matched elements.
    pub fn iter(&self) -> Selections<NodeRef<'a>> {
        Selections::new(self.nodes.clone().into_iter())
    }

    /// Gets the parent of each element in the selection. It returns a
    /// mew Selection object containing these elements.
    pub fn parent(&self) -> Selection<'a> {
        self.derive_selection(|tree_nodes, node| {
            let tree_node = tree_nodes.get(node.id.value)?;
            tree_node.parent.map(|id| NodeRef {
                id,
                tree: node.tree,
            })
        })
    }

    /// Gets the child elements of each element in the selection.
    /// It returns a new Selection object containing these elements.
    pub fn children(&self) -> Selection<'a> {
        let Some(first) = self.nodes().first() else {
            return Default::default();
        };

        let mut set = Vec::with_capacity(self.length());
        let tree_nodes = first.tree.nodes.borrow();

        for node in self.nodes() {
            for child in child_nodes(Ref::clone(&tree_nodes), &node.id, false)
                .flat_map(|id| tree_nodes.get(id.value))
            {
                if !set.contains(&child.id) && child.is_element() {
                    set.push(child.id);
                }
            }
        }

        let result = set.iter().map(|id| NodeRef::new(*id, first.tree)).collect();
        Self { nodes: result }
    }

    /// Gets the ancestor elements of each element in the selection.
    ///
    /// # Arguments
    ///
    /// * `max_depth` - The maximum depth of the ancestors to retrieve.
    ///
    /// # Returns
    ///
    /// A new `Selection` object containing these elements.
    pub fn ancestors(&self, max_depth: Option<usize>) -> Selection<'a> {
        let Some(first) = self.nodes().first() else {
            return Default::default();
        };

        let mut set = Vec::with_capacity(self.length());
        let tree_nodes = first.tree.nodes.borrow();

        for node in self.nodes() {
            for child in ancestor_nodes(Ref::clone(&tree_nodes), &node.id, max_depth)
                .flat_map(|id| tree_nodes.get(id.value))
            {
                if !set.contains(&child.id) && child.is_element() {
                    set.push(child.id);
                }
            }
        }

        let result = set.iter().map(|id| NodeRef::new(*id, first.tree)).collect();
        Self { nodes: result }
    }

    /// Gets the immediately following sibling of each element in the
    /// selection. It returns a new Selection object containing these elements.
    pub fn next_sibling(&self) -> Selection<'a> {
        self.derive_selection(|tree_nodes, node| {
            TreeNodeOps::next_element_sibling_of(tree_nodes.deref(), &node.id)
                .map(|id| NodeRef::new(id, node.tree))
        })
    }

    /// Gets the immediately previous sibling of each element in the
    /// selection. It returns a new Selection object containing these elements.
    pub fn prev_sibling(&self) -> Selection<'a> {
        self.derive_selection(|tree_nodes, node| {
            TreeNodeOps::prev_element_sibling_of(tree_nodes.deref(), &node.id)
                .map(|id| NodeRef::new(id, node.tree))
        })
    }

    fn derive_selection<'b, F>(&self, f: F) -> Selection<'a>
    where
        F: Fn(Ref<Vec<TreeNode>>, &NodeRef<'a>) -> Option<NodeRef<'a>>,
    {
        let Some(first) = self.nodes().first() else {
            return Default::default();
        };

        let mut set = Vec::with_capacity(self.length());
        let tree_nodes = first.tree.nodes.borrow();
        for node in self.nodes() {
            if let Some(derive) = f(Ref::clone(&tree_nodes), node) {
                if !set.contains(&derive.id) {
                    set.push(derive.id);
                }
            }
        }
        let result = set.iter().map(|id| NodeRef::new(*id, first.tree)).collect();
        Self { nodes: result }
    }

    /// Reduces the set of matched elements to the first in the set.
    /// It returns a new selection object, and an empty selection object if the
    /// selection is empty.
    pub fn first(&self) -> Selection<'a> {
        if let Some(first) = self.nodes().first() {
            Selection::from(*first)
        } else {
            Default::default()
        }
    }

    /// Reduces the set of matched elements to the last in the set.
    /// It returns a new selection object, and an empty selection object if the
    /// selection is empty.
    pub fn last(&self) -> Selection<'a> {
        if let Some(last) = self.nodes().last() {
            Selection::from(*last)
        } else {
            Default::default()
        }
    }

    /// Retrieves the underlying node at the specified index.
    pub fn get(&self, index: usize) -> Option<&NodeRef<'a>> {
        self.nodes.get(index)
    }
}

impl Selection<'_> {
    //! internal methods

    /// Ensures that the two selections are from the same tree.
    ///
    /// # Panics
    ///
    /// Panics if the selections are from different trees or if they are empty.
    fn ensure_same_tree(&self, other: &Selection) {
        let tree = self.nodes().first().unwrap().tree;
        let other_tree = other.nodes().first().unwrap().tree;
        if !std::ptr::eq(tree, other_tree) {
            panic!("Selections must be from the same tree");
        }
    }

    /// Creates a new HTML fragment from the provided HTML,
    /// extends the existing tree with the fragment for each node,
    /// and applies a function to each node after the merge.
    fn merge_html_with_fn<T, F>(&self, html: T, f: F)
    where
        T: Into<StrTendril>,
        F: Fn(&mut Vec<TreeNode>, NodeId, &NodeRef),
    {
        let Some(tree) = self.get_tree() else {
            return;
        };
        let mut borrowed = tree.nodes.borrow_mut();
        let fragment = Document::fragment(html);
        for node in self.nodes().iter() {
            let other_tree = fragment.tree.clone();
            TreeNodeOps::merge_with_fn(&mut borrowed, other_tree, |tree_nodes, new_node_id| {
                f(tree_nodes, new_node_id, node);
            });
        }
    }

    fn update_nodes(&self, f: impl Fn(&mut TreeNode)) {
        if let Some(tree) = self.get_tree() {
            let mut borrowed = tree.nodes.borrow_mut();
            for node in self.nodes() {
                if let Some(tree_node) = borrowed.get_mut(node.id.value) {
                    f(tree_node);
                }
            }
        }
    }
    fn update_nodes_by_id(&self, f: impl Fn(&mut Vec<TreeNode>, &NodeId)) {
        if let Some(tree) = self.get_tree() {
            let mut borrowed = tree.nodes.borrow_mut();
            for node in self.nodes() {
                f(&mut borrowed, &node.id);
            }
        }
    }

    fn get_tree(&self) -> Option<&Tree> {
        self.nodes().first().map(|node| node.tree)
    }

    fn text_fn<F>(&self, f: F) -> StrTendril
    where
        F: Fn(Ref<Vec<TreeNode>>, NodeId) -> StrTendril,
    {
        let mut s = StrTendril::new();
        if let Some(tree) = self.get_tree() {
            let tree_nodes = tree.nodes.borrow();
            for node in self.nodes() {
                s.push_tendril(&f(Ref::clone(&tree_nodes), node.id));
            }
        }
        s
    }
}

impl<'a> Selection<'a> {
    /// Iterates over all nodes that match the given matcher. Useful for read-only operations.
    ///
    /// **If elements assumed to be changed during iteration, use [Selection::select_matcher] instead**
    ///  or it will panic with [`std::cell::BorrowMutError`].
    pub fn select_matcher_iter<'b>(
        &self,
        matcher: &'b Matcher,
    ) -> Box<dyn Iterator<Item = NodeRef<'a>> + 'b>
    where
        'a: 'b,
    {
        match self.nodes().len() {
            0 => Box::new(std::iter::empty()),
            1 => {
                let root_node = self.nodes()[0];
                Box::new(DescendantMatches::new(root_node, matcher))
            }
            _ => Box::new(Matches::new(self.nodes.clone().into_iter().rev(), matcher)),
        }
    }
}

/// Iterator over a collection of matched elements.
pub struct Selections<I> {
    iter: IntoIter<I>,
}

impl<I> Selections<I> {
    fn new(iter: IntoIter<I>) -> Self {
        Self { iter }
    }
}

impl<'a> Iterator for Selections<NodeRef<'a>> {
    type Item = Selection<'a>;

    fn next(&mut self) -> Option<Self::Item> {
        self.iter.next().map(Selection::from)
    }
}

impl DoubleEndedIterator for Selections<NodeRef<'_>> {
    fn next_back(&mut self) -> Option<Self::Item> {
        self.iter.next_back().map(Selection::from)
    }
}
