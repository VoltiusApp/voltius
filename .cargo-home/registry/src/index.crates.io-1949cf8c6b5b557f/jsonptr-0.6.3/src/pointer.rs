use crate::{token::InvalidEncodingError, Components, Token, Tokens};
use alloc::{
    borrow::ToOwned,
    fmt,
    string::{String, ToString},
    vec::Vec,
};
use core::{borrow::Borrow, cmp::Ordering, ops::Deref, str::FromStr};

/*
░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
╔══════════════════════════════════════════════════════════════════════════════╗
║                                                                              ║
║                                   Pointer                                    ║
║                                  ¯¯¯¯¯¯¯¯¯                                   ║
╚══════════════════════════════════════════════════════════════════════════════╝
░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
*/

/// A JSON Pointer is a string containing a sequence of zero or more reference
/// [`Token`]s, each prefixed by a `'/'` character.
///
/// See [RFC 6901 for more
/// information](https://datatracker.ietf.org/doc/html/rfc6901).
///
/// ## Example
/// ```rust
/// use jsonptr::{Pointer, resolve::Resolve};
/// use serde_json::{json, Value};
///
/// let data = json!({ "foo": { "bar": "baz" } });
/// let ptr = Pointer::from_static("/foo/bar");
/// let bar = data.resolve(&ptr).unwrap();
/// assert_eq!(bar, "baz");
/// ```
#[derive(Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
// See https://doc.rust-lang.org/src/std/path.rs.html#1985
#[cfg_attr(not(doc), repr(transparent))]
pub struct Pointer(str);

impl Default for &'static Pointer {
    fn default() -> Self {
        Pointer::root()
    }
}
impl core::fmt::Display for Pointer {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        self.0.fmt(f)
    }
}
impl Pointer {
    /// Private constructor for strings that are known to be correctly encoded
    ///
    /// This is a zero-copy constructor
    fn new<S: AsRef<str> + ?Sized>(s: &S) -> &Self {
        unsafe { &*(core::ptr::from_ref::<str>(s.as_ref()) as *const Self) }
    }

    /// Constant reference to a root pointer
    pub const fn root() -> &'static Self {
        // unsafe { &*(core::ptr::from_ref::<str>("") as *const Self) }
        #[allow(clippy::ref_as_ptr)]
        unsafe {
            &*("" as *const str as *const Self)
        }
    }

    /// Attempts to parse a string into a `Pointer`.
    ///
    /// If successful, this does not allocate.
    ///
    /// ## Errors
    /// Returns a `ParseError` if the string is not a valid JSON Pointer.
    pub fn parse<S: AsRef<str> + ?Sized>(s: &S) -> Result<&Self, ParseError> {
        validate(s.as_ref()).map(Self::new)
    }

    /// Creates a static `Pointer` from a string.
    ///
    /// # Panics
    ///
    /// Will panic if the string does not represent a valid pointer.
    ///
    /// # Examples
    ///
    /// ```
    /// use jsonptr::{Pointer, resolve::Resolve};
    /// use serde_json::{json, Value};
    ///
    /// const POINTER: &Pointer = Pointer::from_static("/foo/bar");
    /// let data = json!({ "foo": { "bar": "baz" } });
    /// let bar = data.resolve(POINTER).unwrap();
    /// assert_eq!(bar, "baz");
    /// ```
    pub const fn from_static(s: &'static str) -> &'static Self {
        assert!(validate(s).is_ok(), "invalid json pointer");
        unsafe { &*(core::ptr::from_ref::<str>(s) as *const Self) }
    }

    /// The encoded string representation of this `Pointer`
    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// Converts into an owned [`PointerBuf`]
    pub fn to_buf(&self) -> PointerBuf {
        PointerBuf(self.0.to_string())
    }

    /// Returns an iterator of `Token`s in the `Pointer`.
    pub fn tokens(&self) -> Tokens {
        let mut s = self.0.split('/');
        // skipping the first '/'
        s.next();
        Tokens::new(s)
    }

    /// Returns the number of tokens in the `Pointer`.
    pub fn count(&self) -> usize {
        self.tokens().count()
    }

    /// Returns `true` if the JSON Pointer equals `""`.
    pub fn is_root(&self) -> bool {
        self.0.is_empty()
    }

    /// Returns a `serde_json::Value` representation of this `Pointer`
    #[cfg(feature = "json")]
    pub fn to_json_value(&self) -> serde_json::Value {
        serde_json::Value::String(self.0.to_string())
    }

    /// Returns the last `Token` in the `Pointer`.
    pub fn back(&self) -> Option<Token> {
        self.0
            .rsplit_once('/')
            .map(|(_, back)| Token::from_encoded_unchecked(back))
    }

    /// Returns the last token in the `Pointer`.
    ///
    /// alias for `back`
    pub fn last(&self) -> Option<Token> {
        self.back()
    }

    /// Returns the first `Token` in the `Pointer`.
    pub fn front(&self) -> Option<Token> {
        if self.is_root() {
            return None;
        }
        self.0[1..]
            .split_once('/')
            .map_or_else(
                || Token::from_encoded_unchecked(&self.0[1..]),
                |(front, _)| Token::from_encoded_unchecked(front),
            )
            .into()
    }

    /// Returns the first `Token` in the `Pointer`.
    ///
    /// alias for `front`
    pub fn first(&self) -> Option<Token> {
        self.front()
    }

    /// Splits the `Pointer` into the first `Token` and a remainder `Pointer`.
    pub fn split_front(&self) -> Option<(Token, &Self)> {
        if self.is_root() {
            return None;
        }
        self.0[1..]
            .find('/')
            .map_or_else(
                || (Token::from_encoded_unchecked(&self.0[1..]), Self::root()),
                |idx| {
                    let (front, back) = self.0[1..].split_at(idx);
                    (Token::from_encoded_unchecked(front), Self::new(back))
                },
            )
            .into()
    }
    /// Splits the `Pointer` at the given index if the character at the index is
    /// a separator backslash (`'/'`), returning `Some((head, tail))`. Otherwise,
    /// returns `None`.
    ///
    /// For the following JSON Pointer, the following splits are possible (0, 4, 8):
    /// ```text
    /// /foo/bar/baz
    /// ↑   ↑   ↑
    /// 0   4   8
    /// ```
    /// All other indices will return `None`.
    ///
    /// ## Example
    ///
    /// ```rust
    /// # use jsonptr::Pointer;
    /// let ptr = Pointer::from_static("/foo/bar/baz");
    /// let (head, tail) = ptr.split_at(4).unwrap();
    /// assert_eq!(head, Pointer::from_static("/foo"));
    /// assert_eq!(tail, Pointer::from_static("/bar/baz"));
    /// assert_eq!(ptr.split_at(3), None);
    /// ```
    pub fn split_at(&self, offset: usize) -> Option<(&Self, &Self)> {
        if self.0.as_bytes().get(offset).copied() != Some(b'/') {
            return None;
        }
        let (head, tail) = self.0.split_at(offset);
        Some((Self::new(head), Self::new(tail)))
    }

    /// Splits the `Pointer` into the parent path and the last `Token`.
    pub fn split_back(&self) -> Option<(&Self, Token)> {
        self.0
            .rsplit_once('/')
            .map(|(front, back)| (Self::new(front), Token::from_encoded_unchecked(back)))
    }

    /// A pointer to the parent of the current path.
    pub fn parent(&self) -> Option<&Self> {
        self.0.rsplit_once('/').map(|(front, _)| Self::new(front))
    }

    /// Returns the pointer stripped of the given suffix.
    pub fn strip_suffix<'a>(&'a self, suffix: &Self) -> Option<&'a Self> {
        self.0.strip_suffix(&suffix.0).map(Self::new)
    }

    /// Returns the pointer stripped of the given prefix.
    pub fn strip_prefix<'a>(&'a self, prefix: &Self) -> Option<&'a Self> {
        self.0.strip_prefix(&prefix.0).map(Self::new)
    }
    /// Attempts to get a `Token` by the index. Returns `None` if the index is
    /// out of bounds.
    ///
    /// ## Example
    /// ```rust
    /// use jsonptr::{Pointer, Token};
    ///
    /// let ptr = Pointer::from_static("/foo/bar");
    /// assert_eq!(ptr.get(0), Some("foo".into()));
    /// assert_eq!(ptr.get(1), Some("bar".into()));
    /// assert_eq!(ptr.get(2), None);
    ///
    /// let ptr = Pointer::root();
    /// assert_eq!(ptr.get(0), None);
    /// ```
    pub fn get(&self, index: usize) -> Option<Token> {
        self.tokens().nth(index).clone()
    }

    /// Attempts to resolve a [`R::Value`] based on the path in this [`Pointer`].
    ///
    /// ## Errors
    /// Returns [`R::Error`] if an error occurs while resolving.
    ///
    /// The rules of such are determined by the `R`'s implementation of
    /// [`Resolve`] but provided implementations return [`ResolveError`] if:
    /// - The path is unreachable (e.g. a scalar is encountered prior to the end
    ///   of the path)
    /// - The path is not found (e.g. a key in an object or an index in an array
    ///   does not exist)
    /// - A [`Token`] cannot be parsed as an array [`Index`]
    /// - An array [`Index`] is out of bounds
    ///
    /// [`R::Value`]: `crate::resolve::Resolve::Value`
    /// [`R::Error`]: `crate::resolve::Resolve::Error`
    /// [`Resolve`]: `crate::resolve::Resolve`
    /// [`ResolveError`]: `crate::resolve::ResolveError`
    /// [`Token`]: `crate::Token`
    /// [`Index`]: `crate::index::Index`
    #[cfg(feature = "resolve")]
    pub fn resolve<'v, R: crate::Resolve>(&self, value: &'v R) -> Result<&'v R::Value, R::Error> {
        value.resolve(self)
    }

    /// Attempts to resolve a mutable [`R::Value`] based on the path in this
    /// `Pointer`.
    ///
    /// ## Errors
    /// Returns [`R::Error`] if an error occurs while
    /// resolving.
    ///
    /// The rules of such are determined by the `R`'s implementation of
    /// [`ResolveMut`] but provided implementations return [`ResolveError`] if:
    /// - The path is unreachable (e.g. a scalar is encountered prior to the end
    ///   of the path)
    /// - The path is not found (e.g. a key in an object or an index in an array
    ///   does not exist)
    /// - A [`Token`] cannot be parsed as an array [`Index`]
    /// - An array [`Index`] is out of bounds
    ///
    /// [`R::Value`]: `crate::resolve::ResolveMut::Value`
    /// [`R::Error`]: `crate::resolve::ResolveMut::Error`
    /// [`ResolveMut`]: `crate::resolve::ResolveMut`
    /// [`ResolveError`]: `crate::resolve::ResolveError`
    /// [`Token`]: `crate::Token`
    /// [`Index`]: `crate::index::Index`

    #[cfg(feature = "resolve")]
    pub fn resolve_mut<'v, R: crate::ResolveMut>(
        &self,
        value: &'v mut R,
    ) -> Result<&'v mut R::Value, R::Error> {
        value.resolve_mut(self)
    }

    /// Finds the commonality between this and another `Pointer`.
    pub fn intersection<'a>(&'a self, other: &Self) -> &'a Self {
        if self.is_root() || other.is_root() {
            return Self::root();
        }
        let mut idx = 0;
        for (a, b) in self.tokens().zip(other.tokens()) {
            if a != b {
                break;
            }
            idx += a.encoded().len() + 1;
        }
        self.split_at(idx).map_or(self, |(head, _)| head)
    }

    /// Attempts to delete a `serde_json::Value` based upon the path in this
    /// `Pointer`.
    ///
    /// The rules of deletion are determined by the `D`'s implementation of
    /// [`Delete`]. The supplied implementations (`"json"` & `"toml"`) operate
    /// as follows:
    /// - If the `Pointer` can be resolved, the `Value` is deleted and returned.
    /// - If the `Pointer` fails to resolve for any reason, `Ok(None)` is returned.
    /// - If the `Pointer` is root, `value` is replaced:
    ///     - `"json"`: `serde_json::Value::Null`
    ///     - `"toml"`: `toml::Value::Table::Default`
    ///
    ///
    /// ## Examples
    /// ### Deleting a resolved pointer:
    /// ```rust
    /// use jsonptr::{Pointer, delete::Delete};
    /// use serde_json::json;
    ///
    /// let mut data = json!({ "foo": { "bar": { "baz": "qux" } } });
    /// let ptr = Pointer::from_static("/foo/bar/baz");
    /// assert_eq!(data.delete(&ptr), Some("qux".into()));
    /// assert_eq!(data, json!({ "foo": { "bar": {} } }));
    /// ```
    /// ### Deleting a non-existent Pointer returns `None`:
    /// ```rust
    /// use jsonptr::{ Pointer, delete::Delete };
    /// use serde_json::json;
    ///
    /// let mut data = json!({});
    /// let ptr = Pointer::from_static("/foo/bar/baz");
    /// assert_eq!(ptr.delete(&mut data), None);
    /// assert_eq!(data, json!({}));
    /// ```
    /// ### Deleting a root pointer replaces the value with `Value::Null`:
    /// ```rust
    /// use jsonptr::{Pointer, delete::Delete};
    /// use serde_json::json;
    ///
    /// let mut data = json!({ "foo": { "bar": "baz" } });
    /// let ptr = Pointer::root();
    /// assert_eq!(data.delete(&ptr), Some(json!({ "foo": { "bar": "baz" } })));
    /// assert!(data.is_null());
    /// ```
    ///
    /// [`Delete`]: crate::delete::Delete
    #[cfg(feature = "delete")]
    pub fn delete<D: crate::Delete>(&self, value: &mut D) -> Option<D::Value> {
        value.delete(self)
    }

    /// Attempts to assign `src` to `dest` based on the path in this `Pointer`.
    ///
    /// If the path is partially available, the missing portions will be created. If the path
    /// contains a zero index, such as `"/0"`, then an array will be created. Otherwise, objects
    /// will be utilized to create the missing path.
    ///
    /// ## Example
    /// ```rust
    /// use jsonptr::Pointer;
    /// use serde_json::{json, Value};
    ///
    /// let mut data = json!([]);
    /// let mut ptr = Pointer::from_static("/0/foo");
    /// let replaced = ptr.assign(&mut data, json!("bar")).unwrap();
    /// assert_eq!(data, json!([{"foo": "bar"}]));
    /// assert_eq!(replaced, None);
    /// ```
    ///
    /// ## Errors
    /// Returns [`Assign::Error`] if the path is invalid or if the value cannot be assigned.
    ///
    /// [`Assign::Error`]: crate::assign::Assign::Error
    #[cfg(feature = "assign")]
    pub fn assign<D, V>(&self, dest: &mut D, src: V) -> Result<Option<D::Value>, D::Error>
    where
        D: crate::Assign,
        V: Into<D::Value>,
    {
        dest.assign(self, src)
    }

    /// Returns [`Components`] of this JSON Pointer.
    ///
    /// A [`Component`](crate::Component) is either [`Token`] or the root
    /// location of a document.
    /// ## Example
    /// ```
    /// # use jsonptr::{Component, Pointer};
    /// let ptr = Pointer::parse("/a/b").unwrap();
    /// let mut components = ptr.components();
    /// assert_eq!(components.next(), Some(Component::Root));
    /// assert_eq!(components.next(), Some(Component::Token("a".into())));
    /// assert_eq!(components.next(), Some(Component::Token("b".into())));
    /// assert_eq!(components.next(), None);
    /// ```
    pub fn components(&self) -> Components {
        self.into()
    }

    /// Creates an owned [`PointerBuf`] like `self` but with `token` appended.
    ///
    /// See [`PointerBuf::push_back`] for more details.
    ///
    /// **Note**: this method allocates. If you find yourself calling it more
    /// than once for a given pointer, consider using [`PointerBuf::push_back`]
    /// instead.
    ///
    /// ## Examples
    /// ```
    /// let ptr = jsonptr::Pointer::from_static("/foo");
    /// let foobar = ptr.with_trailing_token("bar");
    /// assert_eq!(foobar, "/foo/bar");
    /// ```
    pub fn with_trailing_token<'t>(&self, token: impl Into<Token<'t>>) -> PointerBuf {
        let mut buf = self.to_buf();
        buf.push_back(token.into());
        buf
    }

    /// Creates an owned [`PointerBuf`] like `self` but with `token` prepended.
    ///
    /// See [`PointerBuf::push_front`] for more details.
    ///
    /// **Note**: this method allocates. If you find yourself calling it more
    /// than once for a given pointer, consider using [`PointerBuf::push_front`]
    /// instead.
    ///
    /// ## Examples
    /// ```
    /// let ptr = jsonptr::Pointer::from_static("/bar");
    /// let foobar = ptr.with_leading_token("foo");
    /// assert_eq!(foobar, "/foo/bar");
    /// ```
    pub fn with_leading_token<'t>(&self, token: impl Into<Token<'t>>) -> PointerBuf {
        let mut buf = self.to_buf();
        buf.push_front(token);
        buf
    }

    /// Creates an owned [`PointerBuf`] like `self` but with `other` appended to
    /// the end.
    ///
    /// See [`PointerBuf::append`] for more details.
    ///
    /// **Note**: this method allocates. If you find yourself calling it more
    /// than once for a given pointer, consider using [`PointerBuf::append`]
    /// instead.
    ///
    /// ## Examples
    /// ```
    /// let ptr = jsonptr::Pointer::from_static("/foo");
    /// let other = jsonptr::Pointer::from_static("/bar/baz");
    /// assert_eq!(ptr.concat(other), "/foo/bar/baz");
    /// ```
    pub fn concat(&self, other: &Pointer) -> PointerBuf {
        let mut buf = self.to_buf();
        buf.append(other);
        buf
    }

    //  Returns the length of `self` in encoded format.
    ///
    /// This length expresses the byte count of the underlying string that
    /// represents the RFC 6091 Pointer. See also [`std::str::len`].
    ///
    /// ## Examples
    /// ```
    /// let mut ptr = jsonptr::Pointer::from_static("/foo/bar").to_buf();
    /// assert_eq!(ptr.len(), 8);
    ///
    /// ptr.push_back("~");
    /// assert_eq!(ptr.len(), 11);
    ///
    /// ```
    pub fn len(&self) -> usize {
        self.0.len()
    }

    /// Returns `true` if the `Pointer` is empty (i.e. root).    
    ///
    /// ## Examples
    /// ```
    /// let mut ptr = jsonptr::PointerBuf::new();
    /// assert!(ptr.is_empty());
    ///
    /// ptr.push_back("foo");
    /// assert!(!ptr.is_empty());
    /// ```
    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
}

#[cfg(feature = "serde")]
impl serde::Serialize for Pointer {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        <str>::serialize(&self.0, serializer)
    }
}

#[cfg(feature = "serde")]
impl<'de: 'p, 'p> serde::Deserialize<'de> for &'p Pointer {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        use serde::de::{Error, Visitor};

        struct PointerVisitor;

        impl<'a> Visitor<'a> for PointerVisitor {
            type Value = &'a Pointer;

            fn expecting(&self, formatter: &mut core::fmt::Formatter) -> core::fmt::Result {
                formatter.write_str("a borrowed Pointer")
            }

            fn visit_borrowed_str<E>(self, v: &'a str) -> Result<Self::Value, E>
            where
                E: Error,
            {
                Pointer::parse(v).map_err(|err| {
                    Error::custom(format!("failed to parse json pointer\n\ncaused by:\n{err}"))
                })
            }
        }

        deserializer.deserialize_str(PointerVisitor)
    }
}

impl ToOwned for Pointer {
    type Owned = PointerBuf;

    fn to_owned(&self) -> Self::Owned {
        self.to_buf()
    }
}

impl PartialEq<&str> for Pointer {
    fn eq(&self, other: &&str) -> bool {
        &&self.0 == other
    }
}
impl<'p> PartialEq<String> for &'p Pointer {
    fn eq(&self, other: &String) -> bool {
        self.0.eq(other)
    }
}
impl PartialEq<str> for Pointer {
    fn eq(&self, other: &str) -> bool {
        &self.0 == other
    }
}

impl PartialEq<Pointer> for &str {
    fn eq(&self, other: &Pointer) -> bool {
        *self == (&other.0)
    }
}

impl PartialEq<Pointer> for String {
    fn eq(&self, other: &Pointer) -> bool {
        self == &other.0
    }
}

impl PartialEq<Pointer> for str {
    fn eq(&self, other: &Pointer) -> bool {
        self == &other.0
    }
}

impl PartialEq<String> for Pointer {
    fn eq(&self, other: &String) -> bool {
        &self.0 == other
    }
}

impl PartialEq<PointerBuf> for Pointer {
    fn eq(&self, other: &PointerBuf) -> bool {
        self.0 == other.0
    }
}

impl PartialEq<Pointer> for PointerBuf {
    fn eq(&self, other: &Pointer) -> bool {
        self.0 == other.0
    }
}
impl PartialEq<PointerBuf> for String {
    fn eq(&self, other: &PointerBuf) -> bool {
        self == &other.0
    }
}
impl PartialEq<String> for PointerBuf {
    fn eq(&self, other: &String) -> bool {
        &self.0 == other
    }
}

impl PartialEq<PointerBuf> for str {
    fn eq(&self, other: &PointerBuf) -> bool {
        self == other.0
    }
}
impl PartialEq<PointerBuf> for &str {
    fn eq(&self, other: &PointerBuf) -> bool {
        *self == other.0
    }
}

impl AsRef<Pointer> for Pointer {
    fn as_ref(&self) -> &Pointer {
        self
    }
}
impl AsRef<Pointer> for PointerBuf {
    fn as_ref(&self) -> &Pointer {
        self
    }
}

impl PartialEq<PointerBuf> for &Pointer {
    fn eq(&self, other: &PointerBuf) -> bool {
        self.0 == other.0
    }
}

impl PartialEq<&Pointer> for PointerBuf {
    fn eq(&self, other: &&Pointer) -> bool {
        self.0 == other.0
    }
}

#[cfg(feature = "json")]
impl From<&Pointer> for serde_json::Value {
    fn from(ptr: &Pointer) -> Self {
        ptr.to_json_value()
    }
}

impl AsRef<str> for Pointer {
    fn as_ref(&self) -> &str {
        &self.0
    }
}

impl Borrow<str> for Pointer {
    fn borrow(&self) -> &str {
        &self.0
    }
}

impl AsRef<[u8]> for Pointer {
    fn as_ref(&self) -> &[u8] {
        self.0.as_bytes()
    }
}

impl PartialOrd<PointerBuf> for Pointer {
    fn partial_cmp(&self, other: &PointerBuf) -> Option<Ordering> {
        self.0.partial_cmp(other.0.as_str())
    }
}

impl PartialOrd<Pointer> for PointerBuf {
    fn partial_cmp(&self, other: &Pointer) -> Option<Ordering> {
        self.0.as_str().partial_cmp(&other.0)
    }
}
impl PartialOrd<&Pointer> for PointerBuf {
    fn partial_cmp(&self, other: &&Pointer) -> Option<Ordering> {
        self.0.as_str().partial_cmp(&other.0)
    }
}

impl PartialOrd<Pointer> for String {
    fn partial_cmp(&self, other: &Pointer) -> Option<Ordering> {
        self.as_str().partial_cmp(&other.0)
    }
}
impl PartialOrd<String> for &Pointer {
    fn partial_cmp(&self, other: &String) -> Option<Ordering> {
        self.0.partial_cmp(other.as_str())
    }
}

impl PartialOrd<PointerBuf> for String {
    fn partial_cmp(&self, other: &PointerBuf) -> Option<Ordering> {
        self.as_str().partial_cmp(other.0.as_str())
    }
}

impl PartialOrd<Pointer> for str {
    fn partial_cmp(&self, other: &Pointer) -> Option<Ordering> {
        self.partial_cmp(&other.0)
    }
}

impl PartialOrd<PointerBuf> for str {
    fn partial_cmp(&self, other: &PointerBuf) -> Option<Ordering> {
        self.partial_cmp(other.0.as_str())
    }
}
impl PartialOrd<PointerBuf> for &str {
    fn partial_cmp(&self, other: &PointerBuf) -> Option<Ordering> {
        (*self).partial_cmp(other.0.as_str())
    }
}
impl PartialOrd<Pointer> for &str {
    fn partial_cmp(&self, other: &Pointer) -> Option<Ordering> {
        (*self).partial_cmp(&other.0)
    }
}

impl PartialOrd<&str> for &Pointer {
    fn partial_cmp(&self, other: &&str) -> Option<Ordering> {
        PartialOrd::partial_cmp(&self.0[..], &other[..])
    }
}

impl PartialOrd<String> for Pointer {
    fn partial_cmp(&self, other: &String) -> Option<Ordering> {
        self.0.partial_cmp(other.as_str())
    }
}

impl PartialOrd<&str> for PointerBuf {
    fn partial_cmp(&self, other: &&str) -> Option<Ordering> {
        PartialOrd::partial_cmp(&self.0[..], &other[..])
    }
}

impl<'p> PartialOrd<PointerBuf> for &'p Pointer {
    fn partial_cmp(&self, other: &PointerBuf) -> Option<Ordering> {
        self.0.partial_cmp(other.0.as_str())
    }
}

impl PartialOrd<String> for PointerBuf {
    fn partial_cmp(&self, other: &String) -> Option<Ordering> {
        self.0.partial_cmp(other)
    }
}

impl<'a> IntoIterator for &'a Pointer {
    type Item = Token<'a>;
    type IntoIter = Tokens<'a>;
    fn into_iter(self) -> Self::IntoIter {
        self.tokens()
    }
}

/*
░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
╔══════════════════════════════════════════════════════════════════════════════╗
║                                                                              ║
║                                  PointerBuf                                  ║
║                                 ¯¯¯¯¯¯¯¯¯¯¯¯                                 ║
╚══════════════════════════════════════════════════════════════════════════════╝
░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
*/

/// An owned, mutable [`Pointer`] (akin to `String`).
///
/// This type provides methods like [`PointerBuf::push_back`] and
/// [`PointerBuf::replace`] that mutate the pointer in place. It also
/// implements [`core::ops::Deref`] to [`Pointer`], meaning that all methods on
/// [`Pointer`] slices are available on `PointerBuf` values as well.
#[derive(Clone, Default, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct PointerBuf(String);

impl PointerBuf {
    /// Creates a new `PointerBuf` pointing to a document root.
    pub fn new() -> Self {
        Self(String::new())
    }

    /// Attempts to parse a string into a `PointerBuf`.
    ///
    /// ## Errors
    /// Returns a [`ParseError`] if the string is not a valid JSON Pointer.
    pub fn parse<S: AsRef<str> + ?Sized>(s: &S) -> Result<Self, ParseError> {
        Pointer::parse(&s).map(Pointer::to_buf)
    }

    /// Creates a new `PointerBuf` from a slice of non-encoded strings.
    pub fn from_tokens<'a, T>(tokens: impl IntoIterator<Item = T>) -> Self
    where
        T: Into<Token<'a>>,
    {
        let mut inner = String::new();
        for t in tokens.into_iter().map(Into::into) {
            inner.push('/');
            inner.push_str(t.encoded());
        }
        PointerBuf(inner)
    }

    /// Coerces to a Pointer slice.
    pub fn as_ptr(&self) -> &Pointer {
        self
    }

    /// Pushes a `Token` onto the front of this `Pointer`.
    pub fn push_front<'t>(&mut self, token: impl Into<Token<'t>>) {
        self.0.insert(0, '/');
        self.0.insert_str(1, token.into().encoded());
    }

    /// Pushes a `Token` onto the back of this `Pointer`.
    pub fn push_back<'t>(&mut self, token: impl Into<Token<'t>>) {
        self.0.push('/');
        self.0.push_str(token.into().encoded());
    }

    /// Removes and returns the last `Token` in the `Pointer` if it exists.
    pub fn pop_back(&mut self) -> Option<Token<'static>> {
        if let Some(idx) = self.0.rfind('/') {
            let back = Token::from_encoded_unchecked(self.0.split_off(idx + 1));
            self.0.pop(); // remove trailing `/`
            Some(back)
        } else {
            None
        }
    }

    /// Removes and returns the first `Token` in the `Pointer` if it exists.
    pub fn pop_front(&mut self) -> Option<Token<'static>> {
        (!self.is_root()).then(|| {
            // if not root, must contain at least one `/`
            let mut token = if let Some(idx) = self.0[1..].find('/') {
                let token = self.0.split_off(idx + 1);
                core::mem::replace(&mut self.0, token)
            } else {
                core::mem::take(&mut self.0)
            };
            token.remove(0); // remove leading `/`
            Token::from_encoded_unchecked(token)
        })
    }

    /// Merges two `Pointer`s by appending `other` onto `self`.
    pub fn append<P: AsRef<Pointer>>(&mut self, other: P) -> &PointerBuf {
        let other = other.as_ref();
        if self.is_root() {
            self.0 = other.0.to_string();
        } else if !other.is_root() {
            self.0.push_str(&other.0);
        }
        self
    }

    /// Attempts to replace a `Token` by the index, returning the replaced
    /// `Token` if it already exists. Returns `None` otherwise.
    ///
    /// ## Errors
    /// A [`ReplaceError`] is returned if the index is out of bounds.
    pub fn replace<'t>(
        &mut self,
        index: usize,
        token: impl Into<Token<'t>>,
    ) -> Result<Option<Token>, ReplaceError> {
        if self.is_root() {
            return Err(ReplaceError {
                count: self.count(),
                index,
            });
        }
        let mut tokens = self.tokens().collect::<Vec<_>>();
        if index >= tokens.len() {
            return Err(ReplaceError {
                count: tokens.len(),
                index,
            });
        }
        let old = tokens.get(index).map(super::token::Token::to_owned);
        tokens[index] = token.into();

        let mut buf = String::new();
        for token in tokens {
            buf.push('/');
            buf.push_str(token.encoded());
        }
        self.0 = buf;

        Ok(old)
    }

    /// Clears the `Pointer`, setting it to root (`""`).
    pub fn clear(&mut self) {
        self.0.clear();
    }
}

impl FromStr for PointerBuf {
    type Err = ParseError;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Self::try_from(s)
    }
}

impl Borrow<Pointer> for PointerBuf {
    fn borrow(&self) -> &Pointer {
        self.as_ptr()
    }
}

impl Deref for PointerBuf {
    type Target = Pointer;
    fn deref(&self) -> &Self::Target {
        Pointer::new(&self.0)
    }
}

#[cfg(feature = "serde")]
impl<'de> serde::Deserialize<'de> for PointerBuf {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        use serde::de::Error;
        let s = String::deserialize(deserializer)?;
        PointerBuf::try_from(s).map_err(D::Error::custom)
    }
}

#[cfg(feature = "serde")]
impl serde::Serialize for PointerBuf {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        String::serialize(&self.0, serializer)
    }
}

impl From<Token<'_>> for PointerBuf {
    fn from(t: Token) -> Self {
        PointerBuf::from_tokens([t])
    }
}

impl TryFrom<String> for PointerBuf {
    type Error = ParseError;
    fn try_from(value: String) -> Result<Self, Self::Error> {
        let _ = validate(&value)?;
        Ok(Self(value))
    }
}

impl From<usize> for PointerBuf {
    fn from(value: usize) -> Self {
        PointerBuf::from_tokens([value])
    }
}

impl<'a> IntoIterator for &'a PointerBuf {
    type Item = Token<'a>;
    type IntoIter = Tokens<'a>;
    fn into_iter(self) -> Self::IntoIter {
        self.tokens()
    }
}

impl TryFrom<&str> for PointerBuf {
    type Error = ParseError;
    fn try_from(value: &str) -> Result<Self, Self::Error> {
        Pointer::parse(value).map(Pointer::to_buf)
    }
}

impl PartialEq<&str> for PointerBuf {
    fn eq(&self, other: &&str) -> bool {
        &self.0 == other
    }
}

impl PartialEq<str> for PointerBuf {
    fn eq(&self, other: &str) -> bool {
        self.0 == other
    }
}

impl core::fmt::Display for PointerBuf {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        self.0.fmt(f)
    }
}

const fn validate(value: &str) -> Result<&str, ParseError> {
    if value.is_empty() {
        return Ok(value);
    }
    let bytes = value.as_bytes();
    if bytes[0] != b'/' {
        return Err(ParseError::NoLeadingBackslash);
    }
    let mut ptr_offset = 0; // offset within the pointer of the most recent '/' separator
    let mut tok_offset = 0; // offset within the current token

    let bytes = value.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'/' => {
                // backslashes ('/') separate tokens
                // we increment the ptr_offset to point to this character
                ptr_offset = i;
                // and reset the token offset
                tok_offset = 0;
            }
            b'~' => {
                // if the character is a '~', then the next character must be '0' or '1'
                // otherwise the encoding is invalid and `InvalidEncodingError` is returned
                if i + 1 >= bytes.len() || (bytes[i + 1] != b'0' && bytes[i + 1] != b'1') {
                    // the pointer is not properly encoded
                    //
                    // we use the pointer offset, which points to the last
                    // encountered separator, as the offset of the error.
                    // The source `InvalidEncodingError` then uses the token
                    // offset.
                    //
                    // "/foo/invalid~encoding"
                    //      ^       ^
                    //      |       |
                    //  ptr_offset  |
                    //          tok_offset
                    //
                    return Err(ParseError::InvalidEncoding {
                        offset: ptr_offset,
                        source: InvalidEncodingError { offset: tok_offset },
                    });
                }
                // already checked the next character, so we skip it
                i += 1;
                // incrementing the pointer offset since the next byte has
                // already been checked
                tok_offset += 1;
            }
            _ => {}
        }
        i += 1;
        // not a separator so we increment the token offset
        tok_offset += 1;
    }
    Ok(value)
}

/*
░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
╔══════════════════════════════════════════════════════════════════════════════╗
║                                                                              ║
║                                  ParseError                                  ║
║                                 ¯¯¯¯¯¯¯¯¯¯¯¯                                 ║
╚══════════════════════════════════════════════════════════════════════════════╝
░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
*/

/// Indicates that a `Pointer` was malformed and unable to be parsed.
#[derive(Debug, PartialEq)]
pub enum ParseError {
    /// `Pointer` did not start with a backslash (`'/'`).
    NoLeadingBackslash,

    /// `Pointer` contained invalid encoding (e.g. `~` not followed by `0` or
    /// `1`).
    InvalidEncoding {
        /// Offset of the partial pointer starting with the token that contained
        /// the invalid encoding
        offset: usize,
        /// The source `InvalidEncodingError`
        source: InvalidEncodingError,
    },
}

impl fmt::Display for ParseError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NoLeadingBackslash { .. } => {
                write!(
                    f,
                    "json pointer is malformed as it does not start with a backslash ('/')"
                )
            }
            Self::InvalidEncoding { source, .. } => write!(f, "{source}"),
        }
    }
}

impl ParseError {
    /// Returns `true` if this error is `NoLeadingBackslash`
    pub fn is_no_leading_backslash(&self) -> bool {
        matches!(self, Self::NoLeadingBackslash { .. })
    }

    /// Returns `true` if this error is `InvalidEncoding`    
    pub fn is_invalid_encoding(&self) -> bool {
        matches!(self, Self::InvalidEncoding { .. })
    }

    /// Offset of the partial pointer starting with the token which caused the error.
    ///
    /// ```text
    /// "/foo/invalid~tilde/invalid"
    ///      ↑
    /// ```
    ///
    /// ```
    /// # use jsonptr::PointerBuf;
    /// let err = PointerBuf::parse("/foo/invalid~tilde/invalid").unwrap_err();
    /// assert_eq!(err.pointer_offset(), 4)
    /// ```
    pub fn pointer_offset(&self) -> usize {
        match *self {
            Self::NoLeadingBackslash { .. } => 0,
            Self::InvalidEncoding { offset, .. } => offset,
        }
    }

    /// Offset of the character index from within the first token of
    /// [`Self::pointer_offset`])
    ///
    /// ```text
    /// "/foo/invalid~tilde/invalid"
    ///              ↑
    ///              8
    /// ```
    /// ```
    /// # use jsonptr::PointerBuf;
    /// let err = PointerBuf::parse("/foo/invalid~tilde/invalid").unwrap_err();
    /// assert_eq!(err.source_offset(), 8)
    /// ```
    pub fn source_offset(&self) -> usize {
        match self {
            Self::NoLeadingBackslash { .. } => 0,
            Self::InvalidEncoding { source, .. } => source.offset,
        }
    }

    /// Offset of the first invalid encoding from within the pointer.
    /// ```text
    /// "/foo/invalid~tilde/invalid"
    ///              ↑
    ///             12
    /// ```
    /// ```
    /// use jsonptr::PointerBuf;
    /// let err = PointerBuf::parse("/foo/invalid~tilde/invalid").unwrap_err();
    /// assert_eq!(err.complete_offset(), 12)
    /// ```
    pub fn complete_offset(&self) -> usize {
        self.source_offset() + self.pointer_offset()
    }
}

#[cfg(feature = "std")]
impl std::error::Error for ParseError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::InvalidEncoding { source, .. } => Some(source),
            Self::NoLeadingBackslash => None,
        }
    }
}

/*
░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
╔══════════════════════════════════════════════════════════════════════════════╗
║                                                                              ║
║                              ReplaceTokenError                               ║
║                             ¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯                              ║
╚══════════════════════════════════════════════════════════════════════════════╝
░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
*/

/// Returned from [`PointerBuf::replace`] when the provided index is out of
/// bounds.
#[derive(Debug, PartialEq, Eq)]
pub struct ReplaceError {
    /// The index of the token that was out of bounds.
    pub index: usize,
    /// The number of tokens in the `Pointer`.
    pub count: usize,
}

impl fmt::Display for ReplaceError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "index {} is out of bounds ({})", self.index, self.count)
    }
}

#[cfg(feature = "std")]
impl std::error::Error for ReplaceError {}

/*
░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
╔══════════════════════════════════════════════════════════════════════════════╗
║                                                                              ║
║                                    Tests                                     ║
║                                   ¯¯¯¯¯¯¯                                    ║
╚══════════════════════════════════════════════════════════════════════════════╝
░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
*/

#[cfg(test)]
mod tests {
    use std::error::Error;

    use super::*;
    use quickcheck::TestResult;
    use quickcheck_macros::quickcheck;

    #[test]
    #[should_panic = "invalid json pointer"]
    fn from_const_validates() {
        let _ = Pointer::from_static("foo/bar");
    }

    #[test]
    fn strip_suffix() {
        let p = Pointer::new("/example/pointer/to/some/value");
        let stripped = p.strip_suffix(Pointer::new("/to/some/value")).unwrap();
        assert_eq!(stripped, "/example/pointer");
    }

    #[test]
    fn strip_prefix() {
        let p = Pointer::new("/example/pointer/to/some/value");
        let stripped = p.strip_prefix(Pointer::new("/example/pointer")).unwrap();
        assert_eq!(stripped, "/to/some/value");
    }

    #[test]
    fn parse_error_is_no_leading_backslash() {
        let err = ParseError::NoLeadingBackslash;
        assert!(err.is_no_leading_backslash());
        assert!(!err.is_invalid_encoding());
    }

    #[test]
    fn parse_error_is_invalid_encoding() {
        let err = ParseError::InvalidEncoding {
            offset: 0,
            source: InvalidEncodingError { offset: 1 },
        };
        assert!(!err.is_no_leading_backslash());
        assert!(err.is_invalid_encoding());
    }

    #[test]
    fn parse() {
        let tests = [
            ("", Ok("")),
            ("/", Ok("/")),
            ("/foo", Ok("/foo")),
            ("/foo/bar", Ok("/foo/bar")),
            ("/foo/bar/baz", Ok("/foo/bar/baz")),
            ("/foo/bar/baz/~0", Ok("/foo/bar/baz/~0")),
            ("/foo/bar/baz/~1", Ok("/foo/bar/baz/~1")),
            ("/foo/bar/baz/~01", Ok("/foo/bar/baz/~01")),
            ("/foo/bar/baz/~10", Ok("/foo/bar/baz/~10")),
            ("/foo/bar/baz/~11", Ok("/foo/bar/baz/~11")),
            ("/foo/bar/baz/~1/~0", Ok("/foo/bar/baz/~1/~0")),
            ("missing-slash", Err(ParseError::NoLeadingBackslash)),
            (
                "/~",
                Err(ParseError::InvalidEncoding {
                    offset: 0,
                    source: InvalidEncodingError { offset: 1 },
                }),
            ),
            (
                "/~2",
                Err(ParseError::InvalidEncoding {
                    offset: 0,
                    source: InvalidEncodingError { offset: 1 },
                }),
            ),
            (
                "/~a",
                Err(ParseError::InvalidEncoding {
                    offset: 0,
                    source: InvalidEncodingError { offset: 1 },
                }),
            ),
        ];
        for (input, expected) in tests {
            let actual = Pointer::parse(input).map(Pointer::as_str);
            assert_eq!(actual, expected);
        }
    }

    #[test]
    fn parse_error_offsets() {
        let err = Pointer::parse("/foo/invalid~encoding").unwrap_err();
        assert_eq!(err.pointer_offset(), 4);
        assert_eq!(err.source_offset(), 8);
        assert_eq!(err.complete_offset(), 12);

        let err = Pointer::parse("invalid~encoding").unwrap_err();
        assert_eq!(err.pointer_offset(), 0);
        assert_eq!(err.source_offset(), 0);

        let err = Pointer::parse("no-leading/slash").unwrap_err();
        assert!(err.source().is_none());
    }

    #[test]
    #[cfg(feature = "std")]
    fn parse_error_source() {
        use std::error::Error;
        let err = Pointer::parse("/foo/invalid~encoding").unwrap_err();
        assert!(err.source().is_some());
        let source = err.source().unwrap();
        assert!(source.is::<InvalidEncodingError>());

        let err = Pointer::parse("no-leading/slash").unwrap_err();
        assert!(err.source().is_none());
    }

    #[test]
    fn pointerbuf_as_pointer_returns_pointer() {
        let ptr = PointerBuf::parse("/foo/bar").unwrap();
        assert_eq!(ptr.as_ptr(), ptr);
    }

    #[test]
    fn pointer_buf_clear() {
        let mut ptr = PointerBuf::from_tokens(["foo", "bar"]);
        ptr.clear();
        assert_eq!(ptr, "");
    }

    #[test]
    fn push_pop_back() {
        let mut ptr = PointerBuf::default();
        assert_eq!(ptr, "", "default, root pointer should equal \"\"");
        assert_eq!(ptr.count(), 0, "default pointer should have 0 tokens");

        ptr.push_back("foo");
        assert_eq!(ptr, "/foo", "pointer should equal \"/foo\" after push_back");

        ptr.push_back("bar");
        assert_eq!(ptr, "/foo/bar");
        ptr.push_back("/baz");
        assert_eq!(ptr, "/foo/bar/~1baz");

        let mut ptr = PointerBuf::from_tokens(["foo", "bar"]);
        assert_eq!(ptr.pop_back(), Some("bar".into()));
        assert_eq!(ptr, "/foo", "pointer should equal \"/foo\" after pop_back");
        assert_eq!(ptr.pop_back(), Some("foo".into()));
        assert_eq!(ptr, "", "pointer should equal \"\" after pop_back");
    }

    #[test]
    fn replace_token() {
        let mut ptr = PointerBuf::try_from("/test/token").unwrap();

        let res = ptr.replace(0, "new");
        assert!(res.is_ok());
        assert_eq!(ptr, "/new/token");

        let res = ptr.replace(3, "invalid");

        assert!(res.is_err());
    }

    #[test]
    fn push_pop_front() {
        let mut ptr = PointerBuf::default();
        assert_eq!(ptr, "");
        assert_eq!(ptr.count(), 0);
        ptr.push_front("bar");
        assert_eq!(ptr, "/bar");
        assert_eq!(ptr.count(), 1);

        ptr.push_front("foo");
        assert_eq!(ptr, "/foo/bar");
        assert_eq!(ptr.count(), 2);

        ptr.push_front("too");
        assert_eq!(ptr, "/too/foo/bar");
        assert_eq!(ptr.count(), 3);

        assert_eq!(ptr.pop_front(), Some("too".into()));
        assert_eq!(ptr, "/foo/bar");
        assert_eq!(ptr.count(), 2);

        assert_eq!(ptr.pop_back(), Some("bar".into()));
        assert_eq!(ptr, "/foo");
        assert_eq!(ptr.count(), 1);
        assert_eq!(ptr.pop_front(), Some("foo".into()));
        assert_eq!(ptr, "");
    }

    #[test]
    fn display_replace_token_error() {
        let err = ReplaceError { index: 3, count: 2 };
        assert_eq!(format!("{err}"), "index 3 is out of bounds (2)");
    }

    #[test]
    fn pop_front_works_with_empty_strings() {
        {
            let mut ptr = PointerBuf::from_tokens(["bar", "", ""]);

            assert_eq!(ptr.tokens().count(), 3);
            let mut token = ptr.pop_front();
            assert_eq!(token, Some(Token::from_encoded_unchecked("bar")));
            assert_eq!(ptr.tokens().count(), 2);
            token = ptr.pop_front();
            assert_eq!(token, Some(Token::from_encoded_unchecked("")));
            assert_eq!(ptr.tokens().count(), 1);
            token = ptr.pop_front();
            assert_eq!(token, Some(Token::from_encoded_unchecked("")));
            assert_eq!(ptr.tokens().count(), 0);
            assert_eq!(ptr, Pointer::root());
        }
        {
            let mut ptr = PointerBuf::new();
            assert_eq!(ptr.tokens().count(), 0);
            ptr.push_back("");
            assert_eq!(ptr.tokens().count(), 1);
            ptr.pop_back();
            assert_eq!(ptr.tokens().count(), 0);
        }
        {
            let mut ptr = PointerBuf::new();
            let input = ["", "", "", "foo", "", "bar", "baz", ""];
            for (idx, &s) in input.iter().enumerate() {
                assert_eq!(ptr.tokens().count(), idx);
                ptr.push_back(s);
            }
            assert_eq!(ptr.tokens().count(), input.len());
            for (idx, s) in input.iter().enumerate() {
                assert_eq!(ptr.tokens().count(), 8 - idx);
                assert_eq!(ptr.front().unwrap().decoded(), *s);
                assert_eq!(ptr.pop_front().unwrap().decoded(), *s);
            }
            assert_eq!(ptr.tokens().count(), 0);
            assert!(ptr.front().is_none());
            assert!(ptr.pop_front().is_none());
        }
    }

    #[test]
    fn formatting() {
        assert_eq!(PointerBuf::from_tokens(["foo", "bar"]), "/foo/bar");
        assert_eq!(
            PointerBuf::from_tokens(["~/foo", "~bar", "/baz"]),
            "/~0~1foo/~0bar/~1baz"
        );
        assert_eq!(PointerBuf::from_tokens(["field", "", "baz"]), "/field//baz");
        assert_eq!(PointerBuf::default(), "");

        let ptr = PointerBuf::from_tokens(["foo", "bar", "baz"]);
        assert_eq!(ptr.to_string(), "/foo/bar/baz");
    }

    #[test]
    fn last() {
        let ptr = Pointer::from_static("/foo/bar");

        assert_eq!(ptr.last(), Some("bar".into()));

        let ptr = Pointer::from_static("/foo/bar/-");
        assert_eq!(ptr.last(), Some("-".into()));

        let ptr = Pointer::from_static("/-");
        assert_eq!(ptr.last(), Some("-".into()));

        let ptr = Pointer::root();
        assert_eq!(ptr.last(), None);

        let ptr = Pointer::from_static("/bar");
        assert_eq!(ptr.last(), Some("bar".into()));
    }

    #[test]
    fn first() {
        let ptr = Pointer::from_static("/foo/bar");
        assert_eq!(ptr.first(), Some("foo".into()));

        let ptr = Pointer::from_static("/foo/bar/-");
        assert_eq!(ptr.first(), Some("foo".into()));

        let ptr = Pointer::root();
        assert_eq!(ptr.first(), None);
    }

    #[test]
    fn pointerbuf_try_from() {
        let ptr = PointerBuf::from_tokens(["foo", "bar", "~/"]);

        assert_eq!(PointerBuf::try_from("/foo/bar/~0~1").unwrap(), ptr);
        let into: PointerBuf = "/foo/bar/~0~1".try_into().unwrap();
        assert_eq!(ptr, into);
    }

    #[test]
    fn default() {
        let ptr = PointerBuf::default();
        assert_eq!(ptr, "");
        assert_eq!(ptr.count(), 0);

        let ptr = <&Pointer>::default();
        assert_eq!(ptr, "");
    }

    #[test]
    #[cfg(all(feature = "serde", feature = "json"))]
    fn to_json_value() {
        use serde_json::Value;
        let ptr = Pointer::from_static("/foo/bar");
        assert_eq!(ptr.to_json_value(), Value::String(String::from("/foo/bar")));
    }

    #[cfg(all(feature = "resolve", feature = "json"))]
    #[test]
    fn resolve() {
        // full tests in resolve.rs
        use serde_json::json;
        let value = json!({
            "foo": {
                "bar": {
                    "baz": "qux"
                }
            }
        });
        let ptr = Pointer::from_static("/foo/bar/baz");
        let resolved = ptr.resolve(&value).unwrap();
        assert_eq!(resolved, &json!("qux"));
    }

    #[cfg(all(feature = "delete", feature = "json"))]
    #[test]
    fn delete() {
        use serde_json::json;
        let mut value = json!({
            "foo": {
                "bar": {
                    "baz": "qux"
                }
            }
        });
        let ptr = Pointer::from_static("/foo/bar/baz");
        let deleted = ptr.delete(&mut value).unwrap();
        assert_eq!(deleted, json!("qux"));
        assert_eq!(
            value,
            json!({
                "foo": {
                    "bar": {}
                }
            })
        );
    }

    #[cfg(all(feature = "assign", feature = "json"))]
    #[test]
    fn assign() {
        use serde_json::json;
        let mut value = json!({});
        let ptr = Pointer::from_static("/foo/bar");
        let replaced = ptr.assign(&mut value, json!("baz")).unwrap();
        assert_eq!(replaced, None);
        assert_eq!(
            value,
            json!({
                "foo": {
                    "bar": "baz"
                }
            })
        );
    }

    #[test]
    fn get() {
        let ptr = Pointer::from_static("/0/1/2/3/4/5/6/7/8/9");
        for i in 0..10 {
            assert_eq!(ptr.get(i).unwrap().decoded(), i.to_string());
        }
    }

    #[test]
    fn replace_token_success() {
        let mut ptr = PointerBuf::from_tokens(["foo", "bar", "baz"]);
        assert!(ptr.replace(1, "qux").is_ok());
        assert_eq!(ptr, PointerBuf::from_tokens(["foo", "qux", "baz"]));

        assert!(ptr.replace(0, "corge").is_ok());
        assert_eq!(ptr, PointerBuf::from_tokens(["corge", "qux", "baz"]));

        assert!(ptr.replace(2, "quux").is_ok());
        assert_eq!(ptr, PointerBuf::from_tokens(["corge", "qux", "quux"]));
    }

    #[test]
    fn replace_token_out_of_bounds() {
        let mut ptr = PointerBuf::from_tokens(["foo", "bar"]);
        assert!(ptr.replace(2, "baz").is_err());
        assert_eq!(ptr, PointerBuf::from_tokens(["foo", "bar"])); // Ensure original pointer is unchanged
    }

    #[test]
    fn replace_token_with_empty_string() {
        let mut ptr = PointerBuf::from_tokens(["foo", "bar", "baz"]);
        assert!(ptr.replace(1, "").is_ok());
        assert_eq!(ptr, PointerBuf::from_tokens(["foo", "", "baz"]));
    }

    #[test]
    fn replace_token_in_empty_pointer() {
        let mut ptr = PointerBuf::default();
        assert!(ptr.replace(0, "foo").is_err());
        assert_eq!(ptr, PointerBuf::default()); // Ensure the pointer remains empty
    }

    #[test]
    fn pop_back_works_with_empty_strings() {
        {
            let mut ptr = PointerBuf::new();
            ptr.push_back("");
            ptr.push_back("");
            ptr.push_back("bar");

            assert_eq!(ptr.tokens().count(), 3);
            ptr.pop_back();
            assert_eq!(ptr.tokens().count(), 2);
            ptr.pop_back();
            assert_eq!(ptr.tokens().count(), 1);
            ptr.pop_back();
            assert_eq!(ptr.tokens().count(), 0);
            assert_eq!(ptr, PointerBuf::new());
        }
        {
            let mut ptr = PointerBuf::new();
            assert_eq!(ptr.tokens().count(), 0);
            ptr.push_back("");
            assert_eq!(ptr.tokens().count(), 1);
            ptr.pop_back();
            assert_eq!(ptr.tokens().count(), 0);
        }
        {
            let mut ptr = PointerBuf::new();
            let input = ["", "", "", "foo", "", "bar", "baz", ""];
            for (idx, &s) in input.iter().enumerate() {
                assert_eq!(ptr.tokens().count(), idx);
                ptr.push_back(s);
            }
            assert_eq!(ptr.tokens().count(), input.len());
            for (idx, s) in input.iter().enumerate().rev() {
                assert_eq!(ptr.tokens().count(), idx + 1);
                assert_eq!(ptr.back().unwrap().decoded(), *s);
                assert_eq!(ptr.pop_back().unwrap().decoded(), *s);
            }
            assert_eq!(ptr.tokens().count(), 0);
            assert!(ptr.back().is_none());
            assert!(ptr.pop_back().is_none());
        }
    }

    #[test]
    // `clippy::useless_asref` is tripping here because the `as_ref` is being
    // called on the same type (`&Pointer`). This is just to ensure that the
    // `as_ref` method is implemented correctly and stays that way.
    #[allow(clippy::useless_asref)]
    fn pointerbuf_as_ref_returns_pointer() {
        let ptr_str = "/foo/bar";
        let ptr = Pointer::from_static(ptr_str);
        let ptr_buf = ptr.to_buf();
        assert_eq!(ptr_buf.as_ref(), ptr);
        let r: &Pointer = ptr.as_ref();
        assert_eq!(ptr, r);

        let s: &str = ptr.as_ref();
        assert_eq!(s, ptr_str);

        let b: &[u8] = ptr.as_ref();
        assert_eq!(b, ptr_str.as_bytes());
    }

    #[test]
    fn from_tokens() {
        let ptr = PointerBuf::from_tokens(["foo", "bar", "baz"]);
        assert_eq!(ptr, "/foo/bar/baz");
    }

    #[test]
    fn pointer_borrow() {
        let ptr = Pointer::from_static("/foo/bar");
        let borrowed: &str = ptr.borrow();
        assert_eq!(borrowed, "/foo/bar");
    }

    #[test]
    #[cfg(feature = "json")]
    fn into_value() {
        use serde_json::Value;
        let ptr = Pointer::from_static("/foo/bar");
        let value: Value = ptr.into();
        assert_eq!(value, Value::String("/foo/bar".to_string()));
    }

    #[test]
    fn intersect() {
        let base = Pointer::from_static("/foo/bar");
        let a = Pointer::from_static("/foo/bar/qux");
        let b = Pointer::from_static("/foo/bar");
        assert_eq!(a.intersection(b), base);

        let base = Pointer::from_static("");
        let a = Pointer::from_static("/foo");
        let b = Pointer::from_static("/");
        assert_eq!(a.intersection(b), base);

        let base = Pointer::from_static("");
        let a = Pointer::from_static("/fooqux");
        let b = Pointer::from_static("/foobar");
        assert_eq!(a.intersection(b), base);
    }

    #[quickcheck]
    fn qc_pop_and_push(mut ptr: PointerBuf) -> bool {
        let original_ptr = ptr.clone();
        let mut tokens = Vec::with_capacity(ptr.count());
        while let Some(token) = ptr.pop_back() {
            tokens.push(token);
        }
        if ptr.count() != 0 || !ptr.is_root() || ptr.last().is_some() || ptr.first().is_some() {
            return false;
        }
        for token in tokens.drain(..) {
            ptr.push_front(token);
        }
        if ptr != original_ptr {
            return false;
        }
        while let Some(token) = ptr.pop_front() {
            tokens.push(token);
        }
        if ptr.count() != 0 || !ptr.is_root() || ptr.last().is_some() || ptr.first().is_some() {
            return false;
        }
        for token in tokens {
            ptr.push_back(token);
        }
        ptr == original_ptr
    }

    #[quickcheck]
    fn qc_split(ptr: PointerBuf) -> bool {
        if let Some((head, tail)) = ptr.split_front() {
            {
                let Some(first) = ptr.first() else {
                    return false;
                };
                if first != head {
                    return false;
                }
            }
            {
                let mut copy = ptr.clone();
                copy.pop_front();
                if copy != tail {
                    return false;
                }
            }
            {
                let mut buf = tail.to_buf();
                buf.push_front(head.clone());
                if buf != ptr {
                    return false;
                }
            }
            {
                let fmt = alloc::format!("/{}{tail}", head.encoded());
                if Pointer::parse(&fmt).unwrap() != ptr {
                    return false;
                }
            }
        } else {
            return ptr.is_root()
                && ptr.count() == 0
                && ptr.last().is_none()
                && ptr.first().is_none();
        }
        if let Some((head, tail)) = ptr.split_back() {
            {
                let Some(last) = ptr.last() else {
                    return false;
                };
                if last != tail {
                    return false;
                }
            }
            {
                let mut copy = ptr.clone();
                copy.pop_back();
                if copy != head {
                    return false;
                }
            }
            {
                let mut buf = head.to_buf();
                buf.push_back(tail.clone());
                if buf != ptr {
                    return false;
                }
            }
            {
                let fmt = alloc::format!("{head}/{}", tail.encoded());
                if Pointer::parse(&fmt).unwrap() != ptr {
                    return false;
                }
            }
            if Some(head) != ptr.parent() {
                return false;
            }
        } else {
            return ptr.is_root()
                && ptr.count() == 0
                && ptr.last().is_none()
                && ptr.first().is_none();
        }
        true
    }

    #[quickcheck]
    fn qc_from_tokens(tokens: Vec<String>) -> bool {
        let buf = PointerBuf::from_tokens(&tokens);
        let reconstructed: Vec<_> = buf.tokens().collect();
        reconstructed
            .into_iter()
            .zip(tokens)
            .all(|(a, b)| a.decoded() == b)
    }

    #[quickcheck]
    fn qc_intersection(base: PointerBuf, suffix_0: PointerBuf, suffix_1: PointerBuf) -> TestResult {
        if suffix_0.first() == suffix_1.first() {
            // base must be the true intersection
            return TestResult::discard();
        }
        let mut a = base.clone();
        a.append(&suffix_0);
        let mut b = base.clone();
        b.append(&suffix_1);
        let isect = a.intersection(&b);
        TestResult::from_bool(isect == base)
    }

    #[cfg(all(feature = "json", feature = "std", feature = "serde"))]
    #[test]
    fn serde() {
        use serde::Deserialize;
        let ptr = PointerBuf::from_tokens(["foo", "bar"]);
        let json = serde_json::to_string(&ptr).unwrap();
        assert_eq!(json, "\"/foo/bar\"");
        let deserialized: PointerBuf = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized, ptr);

        let ptr = Pointer::from_static("/foo/bar");
        let json = serde_json::to_string(&ptr).unwrap();
        assert_eq!(json, "\"/foo/bar\"");

        let mut de = serde_json::Deserializer::from_str("\"/foo/bar\"");
        let p = <&Pointer>::deserialize(&mut de).unwrap();
        assert_eq!(p, ptr);
        let s = serde_json::to_string(p).unwrap();
        assert_eq!(json, s);

        let invalid = serde_json::from_str::<&Pointer>("\"foo/bar\"");
        assert!(invalid.is_err());
        assert_eq!(
            invalid.unwrap_err().to_string(),
            "failed to parse json pointer\n\ncaused by:\njson pointer is malformed as it does not start with a backslash ('/') at line 1 column 9"
        );
    }

    #[test]
    fn to_owned() {
        let ptr = Pointer::from_static("/bread/crumbs");
        let buf = ptr.to_owned();
        assert_eq!(buf, "/bread/crumbs");
    }

    #[test]
    fn concat() {
        let ptr = Pointer::from_static("/foo");
        let barbaz = Pointer::from_static("/bar/baz");
        assert_eq!(ptr.concat(barbaz), "/foo/bar/baz");
    }

    #[test]
    fn with_leading_token() {
        let ptr = Pointer::from_static("/bar");
        let foobar = ptr.with_leading_token("foo");
        assert_eq!(foobar, "/foo/bar");
    }

    #[test]
    fn with_trailing_token() {
        let ptr = Pointer::from_static("/foo");
        let foobar = ptr.with_trailing_token("bar");
        assert_eq!(foobar, "/foo/bar");
    }

    #[test]
    fn len() {
        let ptr = Pointer::from_static("/foo/bar");
        assert_eq!(ptr.len(), 8);
        let mut ptr = ptr.to_buf();
        ptr.push_back("~");
        assert_eq!(ptr.len(), 11);
    }

    #[test]
    fn is_empty() {
        assert!(Pointer::from_static("").is_empty());
        assert!(!Pointer::from_static("/").is_empty());
    }

    #[test]
    #[allow(clippy::cmp_owned, unused_must_use)]
    fn partial_eq() {
        let ptr_string = String::from("/bread/crumbs");
        let ptr_str = "/bread/crumbs";
        let ptr = Pointer::from_static(ptr_str);
        let ptr_buf = ptr.to_buf();
        <&Pointer as PartialEq<&Pointer>>::eq(&ptr, &ptr);
        <Pointer as PartialEq<&str>>::eq(ptr, &ptr_str);
        <&Pointer as PartialEq<String>>::eq(&ptr, &ptr_string);
        <Pointer as PartialEq<String>>::eq(ptr, &ptr_string);
        <Pointer as PartialEq<PointerBuf>>::eq(ptr, &ptr_buf);
        <&str as PartialEq<Pointer>>::eq(&ptr_str, ptr);
        <String as PartialEq<Pointer>>::eq(&ptr_string, ptr);
        <str as PartialEq<Pointer>>::eq(ptr_str, ptr);
        <PointerBuf as PartialEq<str>>::eq(&ptr_buf, ptr_str);
        <PointerBuf as PartialEq<PointerBuf>>::eq(&ptr_buf, &ptr_buf);
        <PointerBuf as PartialEq<Pointer>>::eq(&ptr_buf, ptr);
        <Pointer as PartialEq<PointerBuf>>::eq(ptr, &ptr_buf);
        <PointerBuf as PartialEq<&Pointer>>::eq(&ptr_buf, &ptr);
        <PointerBuf as PartialEq<&str>>::eq(&ptr_buf, &ptr_str);
        <PointerBuf as PartialEq<String>>::eq(&ptr_buf, &ptr_string);
        <&Pointer as PartialEq<PointerBuf>>::eq(&ptr, &ptr_buf);
        <str as PartialEq<PointerBuf>>::eq(ptr_str, &ptr_buf);
        <&str as PartialEq<PointerBuf>>::eq(&ptr_str, &ptr_buf);
        <String as PartialEq<PointerBuf>>::eq(&ptr_string, &ptr_buf);
    }

    #[test]
    fn partial_ord() {
        let a_str = "/foo/bar";
        let a_string = a_str.to_string();
        let a_ptr = Pointer::from_static(a_str);
        let a_buf = a_ptr.to_buf();
        let b_str = "/foo/bar";
        let b_string = b_str.to_string();
        let b_ptr = Pointer::from_static(b_str);
        let b_buf = b_ptr.to_buf();
        let c_str = "/foo/bar/baz";
        let c_string = c_str.to_string();
        let c_ptr = Pointer::from_static(c_str);
        let c_buf = c_ptr.to_buf();

        assert!(<Pointer as PartialOrd<PointerBuf>>::lt(a_ptr, &c_buf));
        assert!(<PointerBuf as PartialOrd<Pointer>>::lt(&a_buf, c_ptr));
        assert!(<String as PartialOrd<Pointer>>::lt(&a_string, c_ptr));
        assert!(<str as PartialOrd<Pointer>>::lt(a_str, c_ptr));
        assert!(<str as PartialOrd<PointerBuf>>::lt(a_str, &c_buf));
        assert!(<&str as PartialOrd<Pointer>>::lt(&a_str, c_ptr));
        assert!(<&str as PartialOrd<PointerBuf>>::lt(&a_str, &c_buf));
        assert!(<&Pointer as PartialOrd<PointerBuf>>::lt(&a_ptr, &c_buf));
        assert!(<&Pointer as PartialOrd<&str>>::lt(&b_ptr, &c_str));
        assert!(<Pointer as PartialOrd<String>>::lt(a_ptr, &c_string));
        assert!(<PointerBuf as PartialOrd<&str>>::lt(&a_buf, &c_str));
        assert!(<PointerBuf as PartialOrd<String>>::lt(&a_buf, &c_string));
        assert!(a_ptr < c_buf);
        assert!(c_buf > a_ptr);
        assert!(a_buf < c_ptr);
        assert!(a_ptr < c_buf);
        assert!(a_ptr < c_ptr);
        assert!(a_ptr <= c_ptr);
        assert!(c_ptr > a_ptr);
        assert!(c_ptr >= a_ptr);
        assert!(a_ptr == b_ptr);
        assert!(a_ptr <= b_ptr);
        assert!(a_ptr >= b_ptr);
        assert!(a_string < c_buf);
        assert!(a_string <= c_buf);
        assert!(c_string > a_buf);
        assert!(c_string >= a_buf);
        assert!(a_string == b_buf);
        assert!(a_ptr < c_buf);
        assert!(a_ptr <= c_buf);
        assert!(c_ptr > a_buf);
        assert!(c_ptr >= a_buf);
        assert!(a_ptr == b_buf);
        assert!(a_ptr <= b_buf);
        assert!(a_ptr >= b_buf);
        assert!(a_ptr < c_buf);
        assert!(c_ptr > b_string);
        // couldn't inline this
        #[allow(clippy::nonminimal_bool)]
        let not = !(a_ptr > c_buf);
        assert!(not);
    }

    #[test]
    fn intersection() {
        struct Test {
            base: &'static str,
            a_suffix: &'static str,
            b_suffix: &'static str,
        }

        let tests = [
            Test {
                base: "",
                a_suffix: "/",
                b_suffix: "/a/b/c",
            },
            Test {
                base: "",
                a_suffix: "",
                b_suffix: "",
            },
            Test {
                base: "/a",
                a_suffix: "/",
                b_suffix: "/suffix",
            },
            Test {
                base: "/a",
                a_suffix: "/suffix",
                b_suffix: "",
            },
            Test {
                base: "/¦\\>‶“lv\u{eedd}\u{8a}Y\n\u{99}𘐷vT\n\u{4}Hª\\ 嗱\\Yl6Y`\"1\u{6dd}\u{17}\0\u{10}ዄ8\"Z닍6i)V;\u{6be4c}\u{b}\u{59836}`\u{1e}㑍§~05\u{1d}\u{8a}[뵔\u{437c3}j\u{f326}\";*\u{c}*U\u{1b}\u{8a}I\u{4}묁",
                a_suffix: "/Y\u{2064}",
                b_suffix: "",
            }
        ];

        for Test {
            base,
            a_suffix,
            b_suffix,
        } in tests
        {
            let base = PointerBuf::parse(base).expect(&format!("failed to parse ${base}"));
            let mut a = base.clone();
            let mut b = base.clone();
            a.append(PointerBuf::parse(a_suffix).unwrap());
            b.append(PointerBuf::parse(b_suffix).unwrap());
            let intersection = a.intersection(&b);
            assert_eq!(intersection, base);
        }
    }
    #[test]
    fn parse_error_display() {
        assert_eq!(
            ParseError::NoLeadingBackslash.to_string(),
            "json pointer is malformed as it does not start with a backslash ('/')"
        );
    }

    #[test]
    fn into_iter() {
        use core::iter::IntoIterator;

        let ptr = PointerBuf::from_tokens(["foo", "bar", "baz"]);
        let tokens: Vec<Token> = ptr.into_iter().collect();
        let from_tokens = PointerBuf::from_tokens(tokens);
        assert_eq!(ptr, from_tokens);

        let ptr = Pointer::from_static("/foo/bar/baz");
        let tokens: Vec<_> = ptr.into_iter().collect();
        assert_eq!(ptr, PointerBuf::from_tokens(tokens));
    }

    #[test]
    fn from_str() {
        let p = PointerBuf::from_str("/foo/bar").unwrap();
        assert_eq!(p, "/foo/bar");
    }

    #[test]
    fn from_token() {
        let p = PointerBuf::from(Token::new("foo"));
        assert_eq!(p, "/foo");
    }

    #[test]
    fn from_usize() {
        let p = PointerBuf::from(0);
        assert_eq!(p, "/0");
    }

    #[test]
    fn borrow() {
        let ptr = PointerBuf::from_tokens(["foo", "bar"]);
        let borrowed: &Pointer = ptr.borrow();
        assert_eq!(borrowed, "/foo/bar");
    }
}
