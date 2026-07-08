//! Serialize [`serde::Serialize`] values to JavaScript using [`serde_json`].
//!
//! # Serialization
//!
//! The [`Serialized`] item can help you create a valid JavaScript value out of a
//! [`serde_json::value::RawValue`], along with some helpful options. It implements [`fmt::Display`]
//! for direct use, but you can also manually remove it from the [new-type] with
//! [`Serialized::into_string()`].
//!
//! ```rust
//! use serialize_to_javascript::{Options, Serialized};
//!
//! fn main() -> serialize_to_javascript::Result<()> {
//!     let raw_value = serde_json::value::to_raw_value("foo'bar")?;
//!     let serialized = Serialized::new(&raw_value, &Options::default());
//!     assert_eq!(serialized.into_string(), "JSON.parse('\"foo\\'bar\"')");
//!     Ok(())
//! }
//! ```
//!
//! # Templating
//!
//! Because of the very common case of wanting to include your JavaScript values into existing
//! JavaScript code, this crate also provides some templating features. [`Template`] helps you map
//! struct fields into template values, while [`DefaultTemplate`] lets you attach it to a specific
//! JavaScript file. See their documentation for more details on how to create and use them.
//!
//! Templated names that are replaced inside templates are `__TEMPLATE_my_field__` where `my_field`
//! is a field on a struct implementing [`Template`]. Raw (`#[raw]` field annotation) value template
//! names use `__RAW_my_field__`. Raw values are inserted directly **without ANY** serialization
//! whatsoever, so being extra careful where it is used is highly recommended.
//!
//! ```rust
//! use serialize_to_javascript::{default_template, DefaultTemplate, Options, Serialized, Template};
//!
//! #[derive(Template)]
//! #[default_template("../tests/keygen.js")]
//! struct Keygen<'a> {
//!     key: &'a str,
//!     length: usize,
//!
//!     #[raw]
//!     optional_script: &'static str,
//! }
//!
//! fn main() -> serialize_to_javascript::Result<()> {
//!     let keygen = Keygen {
//!         key: "asdf",
//!         length: 4,
//!         optional_script: "console.log('hello, from my optional script')",
//!     };
//!
//!     let output: Serialized = keygen.render_default(&Options::default())?;
//!
//!     Ok(())
//! }
//! ```
//!
//! [new-type]: https://doc.rust-lang.org/book/ch19-04-advanced-types.html#using-the-newtype-pattern-for-type-safety-and-abstraction

pub use serde_json::{value::RawValue, Error, Result};
pub use serialize_to_javascript_impl::{default_template, Template};

use std::fmt;

#[doc(hidden)]
pub mod private;

/// JavaScript code (in the form of a function parameter) for the JSON.parse() reviver.
const FREEZE_REVIVER: &str = ",(_,v)=>Object.freeze(v)";

/// Serialized JavaScript output.
#[derive(Debug, Clone)]
pub struct Serialized(String);

impl fmt::Display for Serialized {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(f)
    }
}

impl Serialized {
    /// Create a new [`Serialized`] from the inputs.
    #[inline(always)]
    pub fn new(json: &RawValue, options: &Options) -> Self {
        escape_json_parse(json, options)
    }

    /// Get the inner [`String`] out.
    #[inline(always)]
    pub fn into_string(self) -> String {
        self.0
    }
}

/// Optional settings to pass to the templating system.
#[derive(Debug, Default, Copy, Clone, Eq, PartialEq, Hash)]
pub struct Options {
    /// If the parsed JSON will be frozen with [`Object.freeze()`].
    ///
    /// [`Object.freeze()`]: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/freeze
    #[allow(dead_code)]
    pub freeze: bool,

    /// _Extra_ amount of bytes to allocate to the String buffer during serialization.
    ///
    /// Note: This is not the total buffer size, but the extra buffer size created. By default the
    /// buffer size will already be enough to not need to allocate more than once for input that
    /// does not need escaping. Therefore, this extra buffer is more of "how many bytes of escaped
    /// characters do I want to prepare for?"
    pub buf: usize,
}

/// A struct that contains [`serde::Serialize`] data to insert into a template.
///
/// Create this automatically with a `#[derive(Template)]` attribute. All fields not marked `#[raw]`
/// will be compile-time checked that they implement [`serde::Serialize`].
///
/// Due to the nature of templating variables, [tuple structs] are not allowed as their fields
/// have no names. [Unit structs] have no fields and are a valid target of this trait.
///
/// Template variables are generated as `__TEMPLATE_my_field__` where the serialized value of the
/// `my_field` field replaces all instances of the template variable.
///
/// # Raw Values
///
/// If you have raw values you would like to inject into the template that is not serializable
/// through JSON, such as a string of JavaScript code, then you can mark a field with `#[raw]` to
/// make it embedded directly. **Absolutely NO serialization occurs**, the field is just turned into
/// a string using [`Display`]. As such, fields that are marked `#[raw]` _only_ require [`Display`].
///
/// Raw values use `__RAW_my_field__` as the template variable.
///
/// ---
///
/// This trait is sealed.
///
/// [tuple structs]: https://doc.rust-lang.org/book/ch05-01-defining-structs.html#using-tuple-structs-without-named-fields-to-create-different-types
/// [`Display`]: std::fmt::Display
pub trait Template: self::private::Sealed {
    /// Render the serialized template data into the passed template.
    fn render(&self, template: &str, options: &Options) -> Result<Serialized>;
}

/// A [`Template`] with an attached default template.
///
/// Create this automatically with `#[default_template("myfile.js")` on your [`Template`] struct.
pub trait DefaultTemplate: Template {
    /// The raw static string with the templates contents.
    ///
    /// When using `#[default_template("myfile.js")]` it will be generated as
    /// `include_str!("myfile.js")`.
    const RAW_TEMPLATE: &'static str;

    /// Render the serialized template data into the default template.
    ///
    /// If this method is implemented manually, it still needs to use [`Template::render`] to be
    /// serialized correctly.
    fn render_default(&self, options: &Options) -> Result<Serialized> {
        self.render(Self::RAW_TEMPLATE, options)
    }
}

/// Estimated the minimum capacity needed for the serialized string based on inputs.
///
/// This size will include the size of the wrapping JavaScript (`JSON.parse()` and a potential
/// reviver function based on options) and the user supplied `buf_size` from the passed [`Options`].
/// It currently estimates the minimum size of the passed JSON by assuming it does not need escaping
/// and taking the length of the `&str`.
fn estimated_capacity(json: &RawValue, options: &Options) -> usize {
    // 14 chars in JSON.parse('')
    let mut buf = 14;

    // we know it's at least going to contain the length of the json
    buf += json.get().len();

    // add in user defined extra buffer size
    buf += options.buf;

    // freezing code expands the output size due to the embedded reviver code
    if options.freeze {
        buf += FREEZE_REVIVER.len();
    }

    buf
}

/// Transforms & escapes a JSON String to `JSON.parse('{json}')`
///
/// Single quotes chosen because double quotes are already used in JSON. With single quotes, we only
/// need to escape strings that include backslashes or single quotes. If we used double quotes, then
/// there would be no cases that a string doesn't need escaping.
///
/// # Safety
///
/// The ability to safely escape JSON into a JSON.parse('{json}') relies entirely on 2 things.
///
/// 1. `serde_json`'s ability to correctly escape and format JSON into a [`String`].
/// 2. JavaScript engines not accepting anything except another unescaped, literal single quote
///     character to end a string that was opened with it.
///
/// # Allocations
///
/// A new [`String`] will always be allocated. If `buf_size` is set to `0`, then it will by default
/// allocate to the return value of [`estimated_capacity()`].
fn escape_json_parse(json: &RawValue, options: &Options) -> Serialized {
    let capacity = estimated_capacity(json, options);
    let json = json.get();

    let mut buf = String::with_capacity(capacity);
    buf.push_str("JSON.parse('");

    // insert a backslash before any backslash or single quote characters to escape them
    let mut last = 0;
    for (idx, _) in json.match_indices(|c| c == '\\' || c == '\'') {
        buf.push_str(&json[last..idx]);
        buf.push('\\');
        last = idx;
    }

    // finish appending the trailing json characters that don't need escaping
    buf.push_str(&json[last..]);

    // close out the escaped JavaScript string
    buf.push('\'');

    // custom reviver to freeze all parsed items
    // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/parse#using_the_reviver_parameter
    if options.freeze {
        buf.push_str(FREEZE_REVIVER);
    }

    // finish the JSON.parse() call
    buf.push(')');

    Serialized(buf)
}
