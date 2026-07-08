use crate::{Pointer, Token, Tokens};

/// A single [`Token`] or the root of a JSON Pointer
#[derive(Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Component<'t> {
    /// The document root
    Root,
    /// A segment of a JSON Pointer
    Token(Token<'t>),
}
impl<'t> From<Token<'t>> for Component<'t> {
    fn from(token: Token<'t>) -> Self {
        Self::Token(token)
    }
}

/// An iterator over the [`Component`]s of a JSON Pointer
#[derive(Debug)]
pub struct Components<'t> {
    tokens: Tokens<'t>,
    sent_root: bool,
}

impl<'t> Iterator for Components<'t> {
    type Item = Component<'t>;
    fn next(&mut self) -> Option<Self::Item> {
        if !self.sent_root {
            self.sent_root = true;
            return Some(Component::Root);
        }
        self.tokens.next().map(Component::Token)
    }
}

impl<'t> From<&'t Pointer> for Components<'t> {
    fn from(pointer: &'t Pointer) -> Self {
        Self {
            sent_root: false,
            tokens: pointer.tokens(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn components() {
        let ptr = Pointer::from_static("");
        let components: Vec<_> = Components::from(ptr).collect();
        assert_eq!(components, vec![Component::Root]);

        let ptr = Pointer::from_static("/foo");
        let components = ptr.components().collect::<Vec<_>>();
        assert_eq!(
            components,
            vec![Component::Root, Component::Token("foo".into())]
        );

        let ptr = Pointer::from_static("/foo/bar/-/0/baz");
        let components = ptr.components().collect::<Vec<_>>();
        assert_eq!(
            components,
            vec![
                Component::Root,
                Component::from(Token::from("foo")),
                Component::Token("bar".into()),
                Component::Token("-".into()),
                Component::Token("0".into()),
                Component::Token("baz".into())
            ]
        );
    }
}
