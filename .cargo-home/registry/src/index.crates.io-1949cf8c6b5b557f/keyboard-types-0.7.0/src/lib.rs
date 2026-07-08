//! Contains types to define keyboard related events.
//!
//! The naming and conventions follow the UI Events specification
//! but this crate should be useful for anyone implementing keyboard
//! input in a cross-platform way.

use std::fmt;

pub use crate::code::{Code, UnrecognizedCodeError};
pub use crate::key::{Key, UnrecognizedKeyError};
pub use crate::location::Location;
pub use crate::modifiers::Modifiers;
pub use crate::shortcuts::ShortcutMatcher;

mod code;
mod key;
mod location;
mod modifiers;
mod shortcuts;
#[cfg(feature = "webdriver")]
pub mod webdriver;

#[cfg(feature = "serde")]
use serde::{Deserialize, Serialize};

/// Describes the state the key is in.
#[derive(Copy, Clone, Debug, Eq, Hash, PartialEq)]
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
pub enum KeyState {
    /// Key is pressed.
    ///
    /// In JS: "keydown" event firing.
    Down,
    /// Key is released.
    ///
    /// In JS: "keyup event".
    Up,
}

/// Keyboard events are issued for all pressed and released keys.
#[derive(Clone, Debug, Default, Eq, Hash, PartialEq)]
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
pub struct KeyboardEvent {
    /// Whether the key is pressed or released.
    pub state: KeyState,
    /// Logical key value.
    pub key: Key,
    /// Physical key position.
    pub code: Code,
    /// Location for keys with multiple instances on common keyboards.
    pub location: Location,
    /// Flags for pressed modifier keys.
    pub modifiers: Modifiers,
    /// True if the key is currently auto-repeated.
    pub repeat: bool,
    /// Events with this flag should be ignored in a text editor
    /// and instead composition events should be used.
    pub is_composing: bool,
}

/// Describes the state of a composition session.
#[derive(Copy, Clone, Debug, Eq, Hash, PartialEq)]
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
pub enum CompositionState {
    /// In JS: "compositionstart" event.
    Start,
    /// In JS: "compositionupdate" event.
    Update,
    /// In JS: "compositionend" event.
    ///
    /// In a text editor in this state the data
    /// should be added to the input.
    End,
}

impl fmt::Display for CompositionState {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match self {
            CompositionState::Start => f.write_str("compositionstart"),
            CompositionState::Update => f.write_str("compositionupdate"),
            CompositionState::End => f.write_str("compositionend"),
        }
    }
}

/// Event to expose input methods to program logic.
///
/// Provides information about entered sequences from
/// dead key combinations and IMEs.
///
/// A composition session is always started by a "compositionstart"
/// event followed my zero or more "compositionupdate" events
/// and terminated by a single "compositionend" event.
#[derive(Clone, Debug, Eq, Hash, PartialEq)]
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
pub struct CompositionEvent {
    /// Describes the event kind.
    pub state: CompositionState,
    /// Current composition data. May be empty.
    pub data: String,
}

impl fmt::Display for KeyState {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match self {
            KeyState::Down => f.write_str("keydown"),
            KeyState::Up => f.write_str("keyup"),
        }
    }
}

impl Key {
    /// Determine a *charCode* value for a key with a character value.
    ///
    /// For all other keys the value is zero.
    /// The *charCode* is an implementation specific legacy property of DOM keyboard events.
    ///
    /// Specification: <https://w3c.github.io/uievents/#dom-keyboardevent-charcode>
    pub fn legacy_charcode(&self) -> u32 {
        // Spec: event.charCode = event.key.charCodeAt(0)
        // otherwise 0
        match self {
            Key::Character(ref c) => c.chars().next().unwrap_or('\0') as u32,
            _ => 0,
        }
    }

    /// Determine a *keyCode* value for a key.
    ///
    /// The *keyCode* is an implementation specific legacy property of DOM keyboard events.
    ///
    /// Specification: <https://w3c.github.io/uievents/#dom-keyboardevent-keycode>
    pub fn legacy_keycode(&self) -> u32 {
        match self {
            // See: https://w3c.github.io/uievents/#fixed-virtual-key-codes
            Key::Backspace => 8,
            Key::Tab => 9,
            Key::Enter => 13,
            Key::Shift => 16,
            Key::Control => 17,
            Key::Alt => 18,
            Key::CapsLock => 20,
            Key::Escape => 27,
            Key::PageUp => 33,
            Key::PageDown => 34,
            Key::End => 35,
            Key::Home => 36,
            Key::ArrowLeft => 37,
            Key::ArrowUp => 38,
            Key::ArrowRight => 39,
            Key::ArrowDown => 40,
            Key::Delete => 46,
            Key::Character(ref c) if c.len() == 1 => match first_char(c) {
                ' ' => 32,
                x @ '0'..='9' => x as u32,
                x @ 'a'..='z' => x.to_ascii_uppercase() as u32,
                x @ 'A'..='Z' => x as u32,
                // See: https://w3c.github.io/uievents/#optionally-fixed-virtual-key-codes
                ';' | ':' => 186,
                '=' | '+' => 187,
                ',' | '<' => 188,
                '-' | '_' => 189,
                '.' | '>' => 190,
                '/' | '?' => 191,
                '`' | '~' => 192,
                '[' | '{' => 219,
                '\\' | '|' => 220,
                ']' | '}' => 221,
                '\'' | '\"' => 222,
                _ => 0,
            },
            _ => 0,
        }
    }
}

impl Default for KeyState {
    fn default() -> KeyState {
        KeyState::Down
    }
}

impl Default for Key {
    fn default() -> Key {
        Key::Unidentified
    }
}

impl Default for Code {
    fn default() -> Code {
        Code::Unidentified
    }
}

impl Default for Location {
    fn default() -> Location {
        Location::Standard
    }
}

/// Return the first codepoint of a string.
///
/// # Panics
/// Panics if the string is empty.
fn first_char(s: &str) -> char {
    s.chars().next().expect("empty string")
}
