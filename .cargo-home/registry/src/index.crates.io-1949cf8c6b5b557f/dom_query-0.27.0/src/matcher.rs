use std::fmt;

use bit_set::BitSet;
use cssparser::{CowRcStr, ParseError, SourceLocation, ToCss};
use html5ever::Namespace;
use selectors::context::SelectorCaches;
use selectors::parser::{self, SelectorList, SelectorParseErrorKind};
use selectors::{context, matching, Element};

use crate::css::{CssLocalName, CssString};
use crate::node::{DescendantNodes, NodeRef};
use crate::Tree;
/// CSS selector.
#[derive(Clone, Debug)]
pub struct Matcher {
    selector_list: SelectorList<InnerSelector>,
}

impl Matcher {
    /// creates a new CSS matcher.
    pub fn new(sel: &str) -> Result<Self, ParseError<'_, SelectorParseErrorKind<'_>>> {
        let mut input = cssparser::ParserInput::new(sel);
        let mut parser = cssparser::Parser::new(&mut input);
        selectors::parser::SelectorList::parse(
            &InnerSelectorParser,
            &mut parser,
            parser::ParseRelative::No,
        )
        .map(|selector_list| Matcher { selector_list })
    }

    /// Checks if an element matches Matcher's selection.
    pub fn match_element<E>(&self, element: &E) -> bool
    where
        E: Element<Impl = InnerSelector>,
    {
        let mut caches = context::SelectorCaches::default();
        self.match_element_with_caches(element, &mut caches)
    }

    /// Checks if an element matches Matcher's selection.
    pub fn match_element_with_caches<E>(&self, element: &E, caches: &mut SelectorCaches) -> bool
    where
        E: Element<Impl = InnerSelector>,
    {
        let mut ctx = get_matching_context(caches);
        matching::matches_selector_list(&self.selector_list, element, &mut ctx)
    }
}

pub struct DescendantMatches<'a, 'b> {
    iter: DescendantNodes<'a>,
    matcher: &'b Matcher,
    caches: SelectorCaches,
    tree: &'a Tree,
}

impl<'a, 'b> DescendantMatches<'a, 'b> {
    pub fn new(root_node: NodeRef<'a>, matcher: &'b Matcher) -> Self {
        // Optimized for single-root node scenario - no duplicate checking needed
        let tree = root_node.tree;
        Self {
            iter: tree.descendant_ids_of_it(&root_node.id),
            matcher,
            caches: SelectorCaches::default(),
            tree,
        }
    }
}

impl<'a> Iterator for DescendantMatches<'a, '_> {
    type Item = NodeRef<'a>;

    fn next(&mut self) -> Option<Self::Item> {
        for node_id in self.iter.by_ref() {
            let node = NodeRef::new(node_id, self.tree);
            if !node.is_element() {
                continue;
            }
            if self
                .matcher
                .match_element_with_caches(&node, &mut self.caches)
            {
                return Some(node);
            }
        }
        None
    }
}

pub struct Matches<'a, 'b> {
    nodes: Vec<NodeRef<'a>>,
    matcher: &'b Matcher,
    seen: BitSet,
    caches: SelectorCaches,
}

impl<'a, 'b> Matches<'a, 'b> {
    pub fn new<I: Iterator<Item = NodeRef<'a>>>(root_nodes: I, matcher: &'b Matcher) -> Self {
        // Used for multiple root nodes where duplicate checking is necessary
        let nodes = root_nodes
            .flat_map(|node| node.children_it(true).filter(|n| n.is_element()))
            .collect();

        Self {
            nodes,
            matcher,
            seen: BitSet::new(),
            caches: SelectorCaches::default(),
        }
    }
}

impl<'a> Iterator for Matches<'a, '_> {
    type Item = NodeRef<'a>;

    fn next(&mut self) -> Option<Self::Item> {
        while let Some(node) = self.nodes.pop() {
            if self.seen.contains(node.id.value) {
                continue;
            }
            self.nodes
                .extend(node.children_it(true).filter(|n| n.is_element()));

            if self
                .matcher
                .match_element_with_caches(&node, &mut self.caches)
            {
                self.seen.insert(node.id.value);
                return Some(node);
            }
        }
        None
    }
}

pub(crate) struct InnerSelectorParser;

impl<'i> parser::Parser<'i> for InnerSelectorParser {
    type Impl = InnerSelector;
    type Error = parser::SelectorParseErrorKind<'i>;

    fn parse_is_and_where(&self) -> bool {
        true
    }

    fn parse_has(&self) -> bool {
        true
    }

    fn parse_non_ts_pseudo_class(
        &self,
        location: SourceLocation,
        name: CowRcStr<'i>,
    ) -> Result<NonTSPseudoClass, ParseError<'i, Self::Error>> {
        use self::NonTSPseudoClass::*;
        if name.eq_ignore_ascii_case("any-link") {
            Ok(AnyLink)
        } else if name.eq_ignore_ascii_case("link") {
            Ok(Link)
        } else if name.eq_ignore_ascii_case("visited") {
            Ok(Visited)
        } else if name.eq_ignore_ascii_case("active") {
            Ok(Active)
        } else if name.eq_ignore_ascii_case("focus") {
            Ok(Focus)
        } else if name.eq_ignore_ascii_case("hover") {
            Ok(Hover)
        } else if name.eq_ignore_ascii_case("enabled") {
            Ok(Enabled)
        } else if name.eq_ignore_ascii_case("disabled") {
            Ok(Disabled)
        } else if name.eq_ignore_ascii_case("checked") {
            Ok(Checked)
        } else if name.eq_ignore_ascii_case("indeterminate") {
            Ok(Indeterminate)
        } else if name.eq_ignore_ascii_case("only-text") {
            Ok(OnlyText)
        } else {
            Err(
                location.new_custom_error(SelectorParseErrorKind::UnsupportedPseudoClassOrElement(
                    name,
                )),
            )
        }
    }

    fn parse_non_ts_functional_pseudo_class<'t>(
        &self,
        name: CowRcStr<'i>,
        parser: &mut cssparser::Parser<'i, 't>,
        _after_part: bool,
    ) -> Result<<Self::Impl as parser::SelectorImpl>::NonTSPseudoClass, ParseError<'i, Self::Error>>
    {
        if name.eq_ignore_ascii_case("has-text") {
            let s = parser.expect_string()?.as_ref();
            Ok(NonTSPseudoClass::HasText(CssString::from(s)))
        } else if name.eq_ignore_ascii_case("contains") {
            {
                let s = parser.expect_string()?.as_ref();
                Ok(NonTSPseudoClass::Contains(CssString::from(s)))
            }
        } else {
            Err(
                parser.new_custom_error(SelectorParseErrorKind::UnsupportedPseudoClassOrElement(
                    name,
                )),
            )
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InnerSelector;

impl parser::SelectorImpl for InnerSelector {
    type ExtraMatchingData<'a> = ();
    type AttrValue = CssString;
    type Identifier = CssLocalName;
    type LocalName = CssLocalName;
    type NamespaceUrl = Namespace;
    type NamespacePrefix = CssLocalName;
    type BorrowedLocalName = CssLocalName;
    type BorrowedNamespaceUrl = Namespace;

    type NonTSPseudoClass = NonTSPseudoClass;
    type PseudoElement = PseudoElement;
}

/// Non-tree-structural pseudo-classes.
#[derive(PartialEq, Eq, Clone, Debug)]
pub enum NonTSPseudoClass {
    /// `:any-link` means one of the a, area, or link elements that has an href attribute.
    AnyLink,
    /// `:link` means same as `:any-link`
    Link,
    Visited,
    Active,
    Focus,
    Hover,
    Enabled,
    Disabled,
    Checked,
    Indeterminate,
    /// `:only-text` pseudo-class allows selecting a node with no child elements except a single **text** child node.
    OnlyText,
    /// `:has-text` pseudo-class represents a selection for the element or one of its descendant element that contains the specified text.
    HasText(CssString),
    /// `:contains` pseudo-class represents a selection for the element that contains the specified text (it's own text and text of all his descendant elements).
    Contains(CssString),
}

impl ToCss for NonTSPseudoClass {
    fn to_css<W>(&self, dest: &mut W) -> fmt::Result
    where
        W: fmt::Write,
    {
        match self {
            NonTSPseudoClass::AnyLink => dest.write_str(":any-link"),
            NonTSPseudoClass::Link => dest.write_str(":link"),
            NonTSPseudoClass::Visited => dest.write_str(":visited"),
            NonTSPseudoClass::Active => dest.write_str(":active"),
            NonTSPseudoClass::Focus => dest.write_str(":focus"),
            NonTSPseudoClass::Hover => dest.write_str(":hover"),
            NonTSPseudoClass::Enabled => dest.write_str(":enabled"),
            NonTSPseudoClass::Disabled => dest.write_str(":disabled"),
            NonTSPseudoClass::Checked => dest.write_str(":checked"),
            NonTSPseudoClass::Indeterminate => dest.write_str(":indeterminate"),
            NonTSPseudoClass::OnlyText => dest.write_str(":only-text"),
            NonTSPseudoClass::HasText(s) => {
                dest.write_str(":has-text(")?;
                s.to_css(dest)?;
                dest.write_str(")")
            }
            NonTSPseudoClass::Contains(s) => {
                dest.write_str(":contains(")?;
                s.to_css(dest)?;
                dest.write_str(")")
            }
        }
    }
}

impl parser::NonTSPseudoClass for NonTSPseudoClass {
    type Impl = InnerSelector;

    fn is_active_or_hover(&self) -> bool {
        false
    }

    fn is_user_action_state(&self) -> bool {
        false
    }
}

#[derive(Clone, Eq, PartialEq, Debug)]
pub struct PseudoElement;

impl ToCss for PseudoElement {
    fn to_css<W>(&self, dest: &mut W) -> fmt::Result
    where
        W: fmt::Write,
    {
        dest.write_str("")
    }
}

impl parser::PseudoElement for PseudoElement {
    type Impl = InnerSelector;

    fn accepts_state_pseudo_classes(&self) -> bool {
        false
    }

    fn valid_after_slotted(&self) -> bool {
        false
    }
}

fn get_matching_context(
    caches: &mut context::SelectorCaches,
) -> matching::MatchingContext<'_, InnerSelector> {
    let ctx = matching::MatchingContext::new(
        matching::MatchingMode::Normal,
        None,
        caches,
        matching::QuirksMode::NoQuirks,
        matching::NeedsSelectorFlags::No,
        context::MatchingForInvalidation::No,
    );
    ctx
}
