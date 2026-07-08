use std::borrow::Cow;
use std::cell::{Cell, Ref, RefCell};

#[allow(unused_imports)]
use html5ever::namespace_url;
use html5ever::parse_document;
use html5ever::tree_builder;
use html5ever::tree_builder::{ElementFlags, NodeOrText, QuirksMode, TreeSink};
use html5ever::ParseOpts;
use html5ever::{local_name, ns};
use html5ever::{Attribute, QualName};

use tendril::{StrTendril, TendrilSink};

use crate::dom_tree::Tree;
use crate::entities::wrap_tendril;
use crate::matcher::{DescendantMatches, Matcher};
use crate::node::{Element, NodeData, NodeId, NodeRef, TreeNode};
use crate::selection::Selection;
/// Document represents an HTML document to be manipulated.
#[derive(Clone)]
pub struct Document {
    /// The document's dom tree.
    pub tree: Tree,

    /// Errors that occurred during parsing.
    pub errors: RefCell<Vec<Cow<'static, str>>>,

    /// The document's quirks mode.
    pub quirks_mode: Cell<QuirksMode>,
}

impl Default for Document {
    fn default() -> Self {
        Self {
            tree: Tree::new(NodeData::Document),
            errors: RefCell::new(vec![]),
            quirks_mode: Cell::new(tree_builder::NoQuirks),
        }
    }
}

impl<T: Into<StrTendril>> From<T> for Document {
    fn from(html: T) -> Self {
        let opts = ParseOpts {
            tokenizer: Default::default(),
            tree_builder: tree_builder::TreeBuilderOpts {
                scripting_enabled: false,
                ..Default::default()
            },
        };
        parse_document(Document::default(), opts).one(html)
    }
}

// fragment
impl Document {
    /// Creates a new HTML document fragment.
    pub fn fragment<T: Into<StrTendril>>(html: T) -> Self {
        // Note: The `body` context element is somehow ignored during parsing,
        // so the `html` element becomes the first child of the root node,
        // rather than being nested inside a `body` element as expected.
        html5ever::parse_fragment(
            Document::fragment_sink(),
            ParseOpts {
                tokenizer: Default::default(),
                tree_builder: tree_builder::TreeBuilderOpts {
                    scripting_enabled: false,
                    drop_doctype: true,
                    ..Default::default()
                },
            },
            QualName::new(None, ns!(html), local_name!("body")),
            Vec::new(),
            false,
        )
        .one(html)
    }
    /// Create a new sink for a html document fragment
    pub fn fragment_sink() -> Self {
        Self {
            tree: Tree::new(NodeData::Fragment),
            errors: RefCell::new(vec![]),
            quirks_mode: Cell::new(tree_builder::NoQuirks),
        }
    }
}

// property methods
impl Document {
    /// Return the underlying root document node.
    #[inline]
    pub fn root(&self) -> NodeRef<'_> {
        self.tree.root()
    }

    /// Returns the root element node (`<html>`) of the document.
    pub fn html_root(&self) -> NodeRef<'_> {
        self.tree.html_root()
    }

    /// Gets the HTML contents of the document. It includes
    /// the text and comment nodes.
    pub fn html(&self) -> StrTendril {
        self.root().html()
    }

    /// Gets the HTML contents of the document.
    /// It includes only children nodes.
    pub fn inner_html(&self) -> StrTendril {
        self.root().inner_html()
    }

    /// Gets the HTML contents of the document.
    /// It includes its children nodes.
    pub fn try_html(&self) -> Option<StrTendril> {
        self.root().try_html()
    }

    /// Gets the HTML contents of the document.
    /// It includes only children nodes.
    pub fn try_inner_html(&self) -> Option<StrTendril> {
        self.root().try_inner_html()
    }

    /// Gets the text content of the document.
    pub fn text(&self) -> StrTendril {
        self.root().text()
    }

    /// Returns the formatted text of the document and its descendants. This is the same as
    /// the `text()` method, but with a few differences:
    ///
    /// - Whitespace is normalized so that there is only one space between words.
    /// - All whitespace is removed from the beginning and end of the text.
    /// - After block elements, a double newline is added.
    /// - For elements like `br`, 'hr', 'li', 'tr' a single newline is added.
    pub fn formatted_text(&self) -> StrTendril {
        self.root().formatted_text()
    }

    /// Finds the base URI of the tree by looking for `<base>` tags in document's head.
    ///
    /// The base URI is the value of the `href` attribute of the first
    /// `<base>` tag in the document's head. If no such tag is found,
    /// the method returns `None`.
    ///
    pub fn base_uri(&self) -> Option<StrTendril> {
        self.tree.base_uri()
    }

    /// Returns the document's `<body>` element, or `None` if absent.
    /// For fragments ([crate::NodeData::Fragment]), this typically returns `None`.
    pub fn body(&self) -> Option<NodeRef<'_>> {
        self.tree.body()
    }

    /// Returns the document's `<head>` element, or `None` if absent.
    /// For fragments ([crate::NodeData::Fragment]), this typically returns `None`.
    pub fn head(&self) -> Option<NodeRef<'_>> {
        self.tree.head()
    }

    /// Merges adjacent text nodes and removes empty text nodes.
    ///
    /// Normalization is necessary to ensure that adjacent text nodes are merged into one text node.
    ///
    /// # Example
    ///
    /// ```
    /// use dom_query::Document;
    ///
    /// let doc = Document::from("<div>Hello</div>");
    /// let sel = doc.select("div");
    /// let div = sel.nodes().first().unwrap();
    /// let text1 = doc.tree.new_text(" ");
    /// let text2 = doc.tree.new_text("World");
    /// let text3 = doc.tree.new_text("");
    /// div.append_child(&text1);
    /// div.append_child(&text2);
    /// div.append_child(&text3);
    /// assert_eq!(div.children().len(), 4);
    /// doc.normalize();
    /// assert_eq!(div.children().len(), 1);
    /// assert_eq!(&div.text(), "Hello World");
    /// ```
    pub fn normalize(&self) {
        self.root().normalize();
    }
}

// traversal methods
impl Document {
    /// Gets the descendants of the root document node in the current, filter by a selector.
    /// It returns a new selection object containing these matched elements.
    ///
    /// # Panics
    ///
    /// Panics if failed to parse the given CSS selector.
    pub fn select(&self, sel: &str) -> Selection<'_> {
        let matcher = Matcher::new(sel).expect("Invalid CSS selector");
        self.select_matcher(&matcher)
    }

    /// Alias for `select`, it gets the descendants of the root document node in the current, filter by a selector.
    /// It returns a new selection object containing these matched elements.
    ///
    /// # Panics
    ///
    /// Panics if failed to parse the given CSS selector.
    pub fn nip(&self, sel: &str) -> Selection<'_> {
        self.select(sel)
    }

    /// Gets the descendants of the root document node in the current, filter by a selector.
    /// It returns a new selection object containing these matched elements.
    pub fn try_select(&self, sel: &str) -> Option<Selection<'_>> {
        Matcher::new(sel).ok().and_then(|matcher| {
            let selection = self.select_matcher(&matcher);
            if !selection.is_empty() {
                Some(selection)
            } else {
                None
            }
        })
    }

    /// Gets the descendants of the root document node in the current, filter by a matcher.
    /// It returns a new selection object containing these matched elements.
    pub fn select_matcher(&self, matcher: &Matcher) -> Selection<'_> {
        let root = self.tree.root();
        let nodes = DescendantMatches::new(root, matcher).collect();

        Selection { nodes }
    }

    /// Gets the descendants of the root document node in the current, filter by a matcher.
    /// It returns a new selection object containing elements of the single (first) match.    
    pub fn select_single_matcher(&self, matcher: &Matcher) -> Selection<'_> {
        let node = DescendantMatches::new(self.tree.root(), matcher).next();

        match node {
            Some(node) => node.into(),
            None => Default::default(),
        }
    }

    /// Gets the descendants of the root document node in the current, filter by a selector.
    /// It returns a new selection object containing elements of the single (first) match.
    ///
    /// # Panics
    ///
    /// Panics if failed to parse the given CSS selector.
    pub fn select_single(&self, sel: &str) -> Selection<'_> {
        let matcher = Matcher::new(sel).expect("Invalid CSS selector");
        self.select_single_matcher(&matcher)
    }
}

impl TreeSink for Document {
    type ElemName<'a> = Ref<'a, QualName>;
    /// The overall result of parsing.
    type Output = Self;
    /// Handle is a reference to a DOM node. The tree builder requires that a `Handle` implements `Clone` to get
    /// another reference to the same node.
    type Handle = NodeId;

    /// Consume this sink and return the overall result of parsing.
    #[inline]
    fn finish(self) -> Self {
        self
    }

    /// Signal a parse error.
    #[inline]
    fn parse_error(&self, msg: Cow<'static, str>) {
        let mut errors = self.errors.borrow_mut();
        errors.push(msg);
    }

    /// Get a handle to the `Document` node.
    #[inline]
    fn get_document(&self) -> Self::Handle {
        self.tree.root_id()
    }

    /// Get a handle to a template's template contents. The tree builder promises this will never be called with
    /// something else than a template element.
    #[inline]
    fn get_template_contents(&self, target: &Self::Handle) -> Self::Handle {
        self.tree
            .query_node_or(target, None, |node| {
                node.as_element().and_then(|elem| elem.template_contents)
            })
            .expect("target node is not a template element!")
    }

    /// Set the document's quirks mode.
    #[inline]
    fn set_quirks_mode(&self, mode: QuirksMode) {
        self.quirks_mode.set(mode);
    }

    /// Do two handles refer to the same node?.
    #[inline]
    fn same_node(&self, x: &Self::Handle, y: &Self::Handle) -> bool {
        *x == *y
    }

    /// What is the name of the element?
    /// Should never be called on a non-element node; Feel free to `panic!`.
    #[inline]
    fn elem_name(&self, target: &Self::Handle) -> Self::ElemName<'_> {
        self.tree
            .get_name(target)
            .expect("target node is not an element!")
    }

    /// Create an element.
    /// When creating a template element (`name.ns.expanded() == expanded_name!(html"template")`), an
    /// associated document fragment called the "template contents" should also be created. Later calls to
    /// self.get_template_contents() with that given element return it. See `the template element in the whatwg spec`,
    #[inline]
    fn create_element(
        &self,
        name: QualName,
        attrs: Vec<Attribute>,
        flags: ElementFlags,
    ) -> Self::Handle {
        let mut nodes = self.tree.nodes.borrow_mut();
        let new_elem_id = NodeId::new(nodes.len());
        let template_contents = if flags.template {
            Some(NodeId::new(nodes.len() + 1))
        } else {
            None
        };

        let data = NodeData::Element(Element::new(
            name,
            attrs,
            template_contents,
            flags.mathml_annotation_xml_integration_point,
        ));

        nodes.push(TreeNode::new(new_elem_id, data));

        if let Some(fragment_id) = template_contents {
            nodes.push(TreeNode::new(fragment_id, NodeData::Fragment));
            // The template's content is considered outside of the main document,
            // so its DocumentFragment remains parentless.
        }

        new_elem_id
    }

    /// Create a comment node.
    #[inline]
    fn create_comment(&self, text: StrTendril) -> Self::Handle {
        self.tree.create_node(NodeData::Comment {
            contents: wrap_tendril(text),
        })
    }

    /// Create a Processing Instruction node.
    #[inline]
    fn create_pi(&self, target: StrTendril, data: StrTendril) -> Self::Handle {
        self.tree.create_node(NodeData::ProcessingInstruction {
            target: wrap_tendril(target),
            contents: wrap_tendril(data),
        })
    }

    /// Append a node as the last child of the given node. If this would produce adjacent sibling text nodes, it
    /// should concatenate the text instead.
    /// The child node will not already have a parent.
    fn append(&self, parent: &Self::Handle, child: NodeOrText<Self::Handle>) {
        // Append to an existing Text node if we have one.

        match child {
            NodeOrText::AppendNode(node_id) => self.tree.append_child_of(parent, &node_id),
            NodeOrText::AppendText(text) => {
                let last_child = self.tree.last_child_of(parent);
                let merged = last_child
                    .map(|child| append_to_existing_text(&child, &text))
                    .unwrap_or(false);

                if merged {
                    return;
                }

                self.tree.append_child_data_of(
                    parent,
                    NodeData::Text {
                        contents: wrap_tendril(text),
                    },
                )
            }
        }
    }

    /// Append a node as the sibling immediately before the given node.
    /// The tree builder promises that `sibling` is not a text node. However its old previous sibling, which would
    /// become the new node's previous sibling, could be a text node. If the new node is also a text node, the two
    /// should be merged, as in the behavior of `append`.
    fn append_before_sibling(&self, sibling: &Self::Handle, child: NodeOrText<Self::Handle>) {
        match child {
            NodeOrText::AppendText(text) => {
                let prev_sibling = self.tree.prev_sibling_of(sibling);
                let merged = prev_sibling
                    .map(|sibling| append_to_existing_text(&sibling, &text))
                    .unwrap_or(false);

                if merged {
                    return;
                }

                let id = self.tree.create_node(NodeData::Text {
                    contents: wrap_tendril(text),
                });
                self.tree.insert_before_of(sibling, &id);
            }

            // The tree builder promises we won't have a text node after
            // the insertion point.

            // Any other kind of node.
            NodeOrText::AppendNode(id) => self.tree.insert_before_of(sibling, &id),
        };
    }

    /// When the insertion point is decided by the existence of a parent node of the element, we consider both
    /// possibilities and send the element which will be used if a parent node exists, along with the element to be
    /// used if there isn't one.
    fn append_based_on_parent_node(
        &self,
        element: &Self::Handle,
        prev_element: &Self::Handle,
        child: NodeOrText<Self::Handle>,
    ) {
        let has_parent = self
            .tree
            .nodes
            .borrow()
            .get(element.value)
            .is_some_and(|node| node.parent.is_some());

        if has_parent {
            self.append_before_sibling(element, child);
        } else {
            self.append(prev_element, child);
        }
    }

    /// Append a `DOCTYPE` element to the `Document` node.
    #[inline]
    fn append_doctype_to_document(
        &self,
        name: StrTendril,
        public_id: StrTendril,
        system_id: StrTendril,
    ) {
        let root = self.tree.root_id();
        self.tree.append_child_data_of(
            &root,
            NodeData::Doctype {
                name: wrap_tendril(name),
                public_id: wrap_tendril(public_id),
                system_id: wrap_tendril(system_id),
            },
        );
    }

    /// Add each attribute to the given element, if no attribute with that name already exists. The tree builder
    /// promises this will never be called with something else than an element.
    fn add_attrs_if_missing(&self, target: &Self::Handle, attrs: Vec<Attribute>) {
        self.tree.update_node(target, |node| {
            if let Some(el) = node.as_element_mut() {
                el.add_attrs_if_missing(attrs);
            }
        });
    }

    /// Detach the given node from its parent.
    #[inline]
    fn remove_from_parent(&self, target: &Self::Handle) {
        self.tree.remove_from_parent(target);
    }

    /// Remove all the children from node and append them to new_parent.
    #[inline]
    fn reparent_children(&self, node: &Self::Handle, new_parent: &Self::Handle) {
        self.tree.reparent_children_of(node, Some(*new_parent));
    }

    fn is_mathml_annotation_xml_integration_point(&self, handle: &Self::Handle) -> bool {
        self.tree.is_mathml_annotation_xml_integration_point(handle)
    }
}

fn append_to_existing_text(prev: &NodeRef, text: &StrTendril) -> bool {
    prev.tree
        .update_node(&prev.id, |tree_node| match tree_node.data {
            NodeData::Text { ref mut contents } => {
                #[cfg(not(feature = "atomic"))]
                contents.push_tendril(text);

                #[cfg(feature = "atomic")]
                contents.push_slice(text);
                true
            }
            _ => false,
        })
        .unwrap_or(false)
}

#[cfg(feature = "markdown")]
impl Document {
    /// Produces a *Markdown* representation of the [`Document`],  
    /// skipping elements matching the specified `skip_tags` list along with their descendants.  
    ///  
    /// - If `skip_tags` is `None`, the default list is used: `["script", "style", "meta", "head"]`.  
    /// - To process all elements without exclusions, pass `Some(&[])`.
    pub fn md(&self, skip_tags: Option<&[&str]>) -> StrTendril {
        self.root().md(skip_tags)
    }
}
