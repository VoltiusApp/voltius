//! Keyboard related WebDriver functionality.
//!
//! The low-level `dispatch_keydown` and `dispatch_keyup` API
//! creates keyboard events from WebDriver codes. It is used
//! in the *Perform Actions* API.
//!
//! ```rust
//! # extern crate keyboard_types;
//! # use keyboard_types::*;
//! # use keyboard_types::webdriver::*;
//! let mut state = KeyInputState::new();
//! let mut keyboard_event = state.dispatch_keydown('a');
//! assert_eq!(keyboard_event.state, KeyState::Down);
//! assert_eq!(keyboard_event.key, Key::Character("a".to_owned()));
//! assert_eq!(keyboard_event.code, Code::KeyA);
//!
//! // The `\u{E029}` code is the WebDriver id for the Numpad divide key.
//! keyboard_event = state.dispatch_keydown('\u{E050}');
//! assert_eq!(keyboard_event.key, Key::Shift);
//! assert_eq!(keyboard_event.code, Code::ShiftRight);
//! assert_eq!(keyboard_event.location, Location::Right);
//!
//! keyboard_event = state.dispatch_keyup('\u{E050}').expect("key is released");
//! keyboard_event = state.dispatch_keyup('a').expect("key is released");
//! ```
//!
//! The higher level `send_keys` function is used for the *Element Send Keys*
//! WebDriver API. It accepts a string and returns a sequence of `KeyboardEvent`
//! and `CompositionEvent` values.
//!
//! ```rust
//! # extern crate keyboard_types;
//! # use keyboard_types::*;
//! # use keyboard_types::webdriver::*;
//! let events = send_keys("Hello world!\u{E006}");
//! println!("{:#?}", events);
//!
//! let events = send_keys("A\u{0308}");
//! println!("{:#?}", events);
//! ```
//!
//! Specification: <https://w3c.github.io/webdriver/>

use std::collections::HashSet;

use unicode_segmentation::UnicodeSegmentation;

use crate::first_char;
use crate::{Code, Key, KeyState, KeyboardEvent, Location, Modifiers};
use crate::{CompositionEvent, CompositionState};

// Spec: <https://w3c.github.io/webdriver/#keyboard-actions>
// normalised (sic) as in british spelling
fn normalised_key_value(raw_key: char) -> Key {
    match raw_key {
        '\u{E000}' => Key::Unidentified,
        '\u{E001}' => Key::Cancel,
        '\u{E002}' => Key::Help,
        '\u{E003}' => Key::Backspace,
        '\u{E004}' => Key::Tab,
        '\u{E005}' => Key::Clear,
        // FIXME: spec says "Return"
        '\u{E006}' => Key::Enter,
        '\u{E007}' => Key::Enter,
        '\u{E008}' => Key::Shift,
        '\u{E009}' => Key::Control,
        '\u{E00A}' => Key::Alt,
        '\u{E00B}' => Key::Pause,
        '\u{E00C}' => Key::Escape,
        '\u{E00D}' => Key::Character(" ".to_string()),
        '\u{E00E}' => Key::PageUp,
        '\u{E00F}' => Key::PageDown,
        '\u{E010}' => Key::End,
        '\u{E011}' => Key::Home,
        '\u{E012}' => Key::ArrowLeft,
        '\u{E013}' => Key::ArrowUp,
        '\u{E014}' => Key::ArrowRight,
        '\u{E015}' => Key::ArrowDown,
        '\u{E016}' => Key::Insert,
        '\u{E017}' => Key::Delete,
        '\u{E018}' => Key::Character(";".to_string()),
        '\u{E019}' => Key::Character("=".to_string()),
        '\u{E01A}' => Key::Character("0".to_string()),
        '\u{E01B}' => Key::Character("1".to_string()),
        '\u{E01C}' => Key::Character("2".to_string()),
        '\u{E01D}' => Key::Character("3".to_string()),
        '\u{E01E}' => Key::Character("4".to_string()),
        '\u{E01F}' => Key::Character("5".to_string()),
        '\u{E020}' => Key::Character("6".to_string()),
        '\u{E021}' => Key::Character("7".to_string()),
        '\u{E022}' => Key::Character("8".to_string()),
        '\u{E023}' => Key::Character("9".to_string()),
        '\u{E024}' => Key::Character("*".to_string()),
        '\u{E025}' => Key::Character("+".to_string()),
        '\u{E026}' => Key::Character(",".to_string()),
        '\u{E027}' => Key::Character("-".to_string()),
        '\u{E028}' => Key::Character(".".to_string()),
        '\u{E029}' => Key::Character("/".to_string()),
        '\u{E031}' => Key::F1,
        '\u{E032}' => Key::F2,
        '\u{E033}' => Key::F3,
        '\u{E034}' => Key::F4,
        '\u{E035}' => Key::F5,
        '\u{E036}' => Key::F6,
        '\u{E037}' => Key::F7,
        '\u{E038}' => Key::F8,
        '\u{E039}' => Key::F9,
        '\u{E03A}' => Key::F10,
        '\u{E03B}' => Key::F11,
        '\u{E03C}' => Key::F12,
        '\u{E03D}' => Key::Meta,
        '\u{E040}' => Key::ZenkakuHankaku,
        '\u{E050}' => Key::Shift,
        '\u{E051}' => Key::Control,
        '\u{E052}' => Key::Alt,
        '\u{E053}' => Key::Meta,
        '\u{E054}' => Key::PageUp,
        '\u{E055}' => Key::PageDown,
        '\u{E056}' => Key::End,
        '\u{E057}' => Key::Home,
        '\u{E058}' => Key::ArrowLeft,
        '\u{E059}' => Key::ArrowUp,
        '\u{E05A}' => Key::ArrowRight,
        '\u{E05B}' => Key::ArrowDown,
        '\u{E05C}' => Key::Insert,
        '\u{E05D}' => Key::Delete,
        _ => Key::Character(raw_key.to_string()),
    }
}

/// Spec: <https://w3c.github.io/webdriver/#dfn-code>
fn code(raw_key: char) -> Code {
    match raw_key {
        '`' | '~' => Code::Backquote,
        '\\' | '|' => Code::Backslash,
        '\u{E003}' => Code::Backspace,
        '[' | '{' => Code::BracketLeft,
        ']' | '}' => Code::BracketRight,
        ',' | '<' => Code::Comma,
        '0' | ')' => Code::Digit0,
        '1' | '!' => Code::Digit1,
        '2' | '@' => Code::Digit2,
        '3' | '#' => Code::Digit3,
        '4' | '$' => Code::Digit4,
        '5' | '%' => Code::Digit5,
        '6' | '^' => Code::Digit6,
        '7' | '&' => Code::Digit7,
        '8' | '*' => Code::Digit8,
        '9' | '(' => Code::Digit9,
        '=' | '+' => Code::Equal,
        // FIXME: spec has '<' | '>' => Code::IntlBackslash,
        'a' | 'A' => Code::KeyA,
        'b' | 'B' => Code::KeyB,
        'c' | 'C' => Code::KeyC,
        'd' | 'D' => Code::KeyD,
        'e' | 'E' => Code::KeyE,
        'f' | 'F' => Code::KeyF,
        'g' | 'G' => Code::KeyG,
        'h' | 'H' => Code::KeyH,
        'i' | 'I' => Code::KeyI,
        'j' | 'J' => Code::KeyJ,
        'k' | 'K' => Code::KeyK,
        'l' | 'L' => Code::KeyL,
        'm' | 'M' => Code::KeyM,
        'n' | 'N' => Code::KeyN,
        'o' | 'O' => Code::KeyO,
        'p' | 'P' => Code::KeyP,
        'q' | 'Q' => Code::KeyQ,
        'r' | 'R' => Code::KeyR,
        's' | 'S' => Code::KeyS,
        't' | 'T' => Code::KeyT,
        'u' | 'U' => Code::KeyU,
        'v' | 'V' => Code::KeyV,
        'w' | 'W' => Code::KeyW,
        'x' | 'X' => Code::KeyX,
        'y' | 'Y' => Code::KeyY,
        'z' | 'Z' => Code::KeyZ,
        '-' | '_' => Code::Minus,
        '.' | '>' => Code::Period,
        '\'' | '"' => Code::Quote,
        ';' | ':' => Code::Semicolon,
        '/' | '?' => Code::Slash,
        '\u{E00A}' => Code::AltLeft,
        '\u{E052}' => Code::AltRight,
        '\u{E009}' => Code::ControlLeft,
        '\u{E051}' => Code::ControlRight,
        '\u{E006}' => Code::Enter,
        // FIXME: spec says "OSLeft"
        '\u{E03D}' => Code::MetaLeft,
        // FIXME: spec says "OSRight"
        '\u{E053}' => Code::MetaRight,
        '\u{E008}' => Code::ShiftLeft,
        '\u{E050}' => Code::ShiftRight,
        ' ' | '\u{E00D}' => Code::Space,
        '\u{E004}' => Code::Tab,
        '\u{E017}' => Code::Delete,
        '\u{E010}' => Code::End,
        '\u{E002}' => Code::Help,
        '\u{E011}' => Code::Home,
        '\u{E016}' => Code::Insert,
        // FIXME: spec says '\u{E01E}' => Code::PageDown, which is Numpad 4
        '\u{E00F}' => Code::PageDown,
        // FIXME: spec says '\u{E01F}' => Code::PageUp, which is Numpad 5
        '\u{E00E}' => Code::PageUp,
        '\u{E015}' => Code::ArrowDown,
        '\u{E012}' => Code::ArrowLeft,
        '\u{E014}' => Code::ArrowRight,
        '\u{E013}' => Code::ArrowUp,
        '\u{E00C}' => Code::Escape,
        '\u{E031}' => Code::F1,
        '\u{E032}' => Code::F2,
        '\u{E033}' => Code::F3,
        '\u{E034}' => Code::F4,
        '\u{E035}' => Code::F5,
        '\u{E036}' => Code::F6,
        '\u{E037}' => Code::F7,
        '\u{E038}' => Code::F8,
        '\u{E039}' => Code::F9,
        '\u{E03A}' => Code::F10,
        '\u{E03B}' => Code::F11,
        '\u{E03C}' => Code::F12,
        '\u{E01A}' | '\u{E05C}' => Code::Numpad0,
        '\u{E01B}' | '\u{E056}' => Code::Numpad1,
        '\u{E01C}' | '\u{E05B}' => Code::Numpad2,
        '\u{E01D}' | '\u{E055}' => Code::Numpad3,
        '\u{E01E}' | '\u{E058}' => Code::Numpad4,
        '\u{E01F}' => Code::Numpad5,
        '\u{E020}' | '\u{E05A}' => Code::Numpad6,
        '\u{E021}' | '\u{E057}' => Code::Numpad7,
        '\u{E022}' | '\u{E059}' => Code::Numpad8,
        '\u{E023}' | '\u{E054}' => Code::Numpad9,
        // FIXME: spec says uE024
        '\u{E025}' => Code::NumpadAdd,
        '\u{E026}' => Code::NumpadComma,
        '\u{E028}' | '\u{E05D}' => Code::NumpadDecimal,
        '\u{E029}' => Code::NumpadDivide,
        '\u{E007}' => Code::NumpadEnter,
        '\u{E024}' => Code::NumpadMultiply,
        // FIXME: spec says uE026
        '\u{E027}' => Code::NumpadSubtract,
        _ => Code::Unidentified,
    }
}

fn is_shifted_character(raw_key: char) -> bool {
    matches!(
        raw_key,
        '~' | '|'
            | '{'
            | '}'
            | '<'
            | ')'
            | '!'
            | '@'
            | '#'
            | '$'
            | '%'
            | '^'
            | '&'
            | '*'
            | '('
            | '+'
            | '>'
            | '_'
            | '\"'
            | ':'
            | '?'
            | '\u{E00D}'
            | '\u{E05C}'
            | '\u{E056}'
            | '\u{E05B}'
            | '\u{E055}'
            | '\u{E058}'
            | '\u{E05A}'
            | '\u{E057}'
            | '\u{E059}'
            | '\u{E054}'
            | '\u{E05D}'
            | 'A'..='Z'
    )
}

fn key_location(raw_key: char) -> Location {
    match raw_key {
        '\u{E007}'..='\u{E00A}' => Location::Left,
        '\u{E01A}'..='\u{E029}' => Location::Numpad,
        '\u{E03D}' => Location::Left,
        '\u{E050}'..='\u{E053}' => Location::Right,
        '\u{E054}'..='\u{E05D}' => Location::Numpad,
        _ => Location::Standard,
    }
}

fn get_modifier(key: &Key) -> Modifiers {
    match key {
        Key::Alt => Modifiers::ALT,
        Key::Shift => Modifiers::SHIFT,
        Key::Control => Modifiers::CONTROL,
        Key::Meta => Modifiers::META,
        _ => Modifiers::empty(),
    }
}

/// Store pressed keys and modifiers.
///
/// Spec: <https://w3c.github.io/webdriver/#dfn-key-input-state>
#[derive(Clone, Debug, Default)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct KeyInputState {
    pressed: HashSet<Key>,
    modifiers: Modifiers,
}

impl KeyInputState {
    /// New state without any keys or modifiers pressed.
    ///
    /// Same as the default value.
    pub fn new() -> KeyInputState {
        KeyInputState::default()
    }

    /// Get a keyboard-keydown event from a WebDriver key value.
    ///
    /// Stores that the key is pressed in the state object.
    ///
    /// The input cancel list is not implemented here but can be emulated
    /// by adding the `raw_key` value with a `keyUp` action to a list
    /// before executing this function.
    ///
    /// Specification: <https://w3c.github.io/webdriver/#dfn-dispatch-a-keydown-action>
    pub fn dispatch_keydown(&mut self, raw_key: char) -> KeyboardEvent {
        let key = normalised_key_value(raw_key);
        let repeat = self.pressed.contains(&key);
        let code = code(raw_key);
        let location = key_location(raw_key);
        self.modifiers.insert(get_modifier(&key));
        self.pressed.insert(key.clone());
        KeyboardEvent {
            state: KeyState::Down,
            key,
            code,
            location,
            modifiers: self.modifiers,
            repeat,
            is_composing: false,
        }
    }

    /// Get a keyboard-keyup event from a WebDriver key value.
    ///
    /// Updates state. Returns `None` if the key is not listed as pressed.
    ///
    /// Specification: <https://w3c.github.io/webdriver/#dfn-dispatch-a-keyup-action>
    pub fn dispatch_keyup(&mut self, raw_key: char) -> Option<KeyboardEvent> {
        let key = normalised_key_value(raw_key);
        if !self.pressed.contains(&key) {
            return None;
        }
        let code = code(raw_key);
        let location = key_location(raw_key);
        self.modifiers.remove(get_modifier(&key));
        self.pressed.remove(&key);
        Some(KeyboardEvent {
            state: KeyState::Up,
            key,
            code,
            location,
            modifiers: self.modifiers,
            repeat: false,
            is_composing: false,
        })
    }

    fn clear(&mut self, undo_actions: &mut HashSet<char>, result: &mut Vec<Event>) {
        let mut actions: Vec<_> = undo_actions.drain().collect();
        actions.sort_unstable();
        for action in actions {
            result.push(self.dispatch_keyup(action).unwrap().into())
        }
        assert!(undo_actions.is_empty());
    }

    fn dispatch_typeable(&mut self, text: &mut String, result: &mut Vec<Event>) {
        for character in text.chars() {
            let shifted = self.modifiers.contains(Modifiers::SHIFT);
            if is_shifted_character(character) && !shifted {
                // dispatch left shift down
                result.push(self.dispatch_keydown('\u{E008}').into());
            }
            if !is_shifted_character(character) && shifted {
                // dispatch left shift up
                result.push(self.dispatch_keyup('\u{E008}').unwrap().into());
            }
            result.push(self.dispatch_keydown(character).into());
            result.push(self.dispatch_keyup(character).unwrap().into());
        }
        text.clear();
    }
}

/// Either a `KeyboardEvent` or a `CompositionEvent`.
///
/// Returned by the `send_keys` function.
#[derive(Clone, Eq, PartialEq, Hash, Debug)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub enum Event {
    Keyboard(KeyboardEvent),
    Composition(CompositionEvent),
}

impl From<KeyboardEvent> for Event {
    fn from(v: KeyboardEvent) -> Event {
        Event::Keyboard(v)
    }
}

impl From<CompositionEvent> for Event {
    fn from(v: CompositionEvent) -> Event {
        Event::Composition(v)
    }
}

/// Compute the events resulting from a WebDriver *Element Send Keys* command.
///
/// Spec: <https://w3c.github.io/webdriver/#element-send-keys>
pub fn send_keys(text: &str) -> Vec<Event> {
    fn is_modifier(text: &str) -> bool {
        if text.chars().count() != 1 {
            return false;
        }
        // values from <https://www.w3.org/TR/uievents-key/#keys-modifier>
        matches!(
            normalised_key_value(first_char(text)),
            Key::Alt
                | Key::AltGraph
                | Key::CapsLock
                | Key::Control
                | Key::Fn
                | Key::FnLock
                | Key::Meta
                | Key::NumLock
                | Key::ScrollLock
                | Key::Shift
                | Key::Symbol
                | Key::SymbolLock
                | Key::Hyper
                | Key::Super
        )
    }

    /// Spec: <https://w3c.github.io/webdriver/#dfn-typeable>
    fn is_typeable(text: &str) -> bool {
        text.chars().count() == 1
    }

    let mut result = Vec::new();
    let mut typeable_text = String::new();
    let mut state = KeyInputState::new();
    let mut undo_actions = HashSet::new();
    for cluster in UnicodeSegmentation::graphemes(text, true) {
        match cluster {
            "\u{E000}" => {
                state.dispatch_typeable(&mut typeable_text, &mut result);
                state.clear(&mut undo_actions, &mut result);
            }
            s if is_modifier(s) => {
                state.dispatch_typeable(&mut typeable_text, &mut result);
                let raw_modifier = first_char(s);
                result.push(state.dispatch_keydown(raw_modifier).into());
                undo_actions.insert(raw_modifier);
            }
            s if is_typeable(s) => typeable_text.push_str(s),
            s => {
                state.dispatch_typeable(&mut typeable_text, &mut result);
                // FIXME: Spec says undefined instead of empty string
                result.push(
                    CompositionEvent {
                        state: CompositionState::Start,
                        data: String::new(),
                    }
                    .into(),
                );
                result.push(
                    CompositionEvent {
                        state: CompositionState::Update,
                        data: s.to_owned(),
                    }
                    .into(),
                );
                result.push(
                    CompositionEvent {
                        state: CompositionState::End,
                        data: s.to_owned(),
                    }
                    .into(),
                );
            }
        }
    }
    state.dispatch_typeable(&mut typeable_text, &mut result);
    state.clear(&mut undo_actions, &mut result);
    result
}
