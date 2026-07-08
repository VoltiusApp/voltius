use crate::{Key, KeyState, KeyboardEvent, Modifiers};

/// Match keyboard shortcuts and excute actions.
///
/// Every shortcut consists of a list of modifier keys pressed and a
/// single non-modifier key pressed.
///
/// The Control + C shortcut requires the user to hold down the Control
/// modifier key. When the C key is pressed the action (usually copy)
/// is triggered. The event is consumed so other matchers don't also
/// act on the shortcut. This is also true for the release of the
/// C key as else only key release events would be forwarded.
///
/// ASCII letters are compared ignoring case. Only takes
/// the shift, control, alt and meta modifiers into account.
/// If other modifiers beside those expected are found
/// the shortcut is not matched.
pub struct ShortcutMatcher<T> {
    state: KeyState,
    key: Key,
    modifiers: Modifiers,
    matched: bool,
    value: Option<T>,
}

impl<T> ShortcutMatcher<T> {
    /// Create a new shortcut matcher.
    pub fn new(state: KeyState, key: Key, mut modifiers: Modifiers) -> ShortcutMatcher<T> {
        modifiers &= Modifiers::SHIFT | Modifiers::CONTROL | Modifiers::ALT | Modifiers::META;
        ShortcutMatcher {
            state,
            key,
            modifiers,
            matched: false,
            value: None,
        }
    }

    /// Create a new matcher from an event.
    ///
    /// Only state, key and modifiers are stored. The other attributes are discarded.
    pub fn from_event(key_event: KeyboardEvent) -> ShortcutMatcher<T> {
        ShortcutMatcher::new(key_event.state, key_event.key, key_event.modifiers)
    }

    /// Test a keyboard shortcut.
    ///
    /// If the modifiers are active and the key is pressed
    /// execute the provided function.
    ///
    /// ```rust
    /// # use keyboard_types::{Key, KeyboardEvent, Modifiers, ShortcutMatcher};
    /// # fn do_something() {}
    /// # fn forward_event() {}
    /// # let event = KeyboardEvent {
    /// #     state: keyboard_types::KeyState::Down,
    /// #     key: Key::Enter,
    /// #     code: keyboard_types::Code::Enter,
    /// #     location: keyboard_types::Location::Standard,
    /// #     modifiers: Modifiers::empty(),
    /// #     repeat: false,
    /// #     is_composing: false,
    /// # };
    /// // Create a matcher from a keyboard event.
    /// // Shortcuts are tested in-order.
    /// ShortcutMatcher::from_event(event)
    /// // Do something if the Tab key is pressed.
    /// .shortcut(Modifiers::empty(), Key::Tab, do_something)
    /// // If Shift + Tab are pressed do something.
    /// // This is executed because the previous shortcut requires modifiers to be empty.
    /// .shortcut(Modifiers::SHIFT, Key::Tab, do_something)
    /// // Instead of named keys letters and other characters can be used.
    /// .shortcut(Modifiers::CONTROL, 'L', do_something)
    /// // Multiple modifiers are combined with bitwise OR (`|`) to form a new mask.
    /// .shortcut(Modifiers::CONTROL | Modifiers::SHIFT, 'X', do_something)
    /// // If none of the previous shortcuts matched forward the event.
    /// .otherwise(forward_event);
    /// ```
    pub fn shortcut<K, F>(mut self, modifiers: Modifiers, key: K, f: F) -> ShortcutMatcher<T>
    where
        K: MatchKey,
        F: (FnOnce() -> T),
    {
        if self.matched {
            return self;
        }
        if modifiers == self.modifiers && key.match_key(&self.key) {
            if self.state == KeyState::Down {
                self.value = Some(f());
            }
            self.matched = true;
        }
        self
    }

    /// Only test a shortcut if the enabled flag is set.
    ///
    /// If the `enabled` flag is true behaves the same as
    /// `shortcut` otherwise does nothing.
    ///
    /// This is especially useful for platform specific shortcuts.
    ///
    /// ```rust
    /// # use keyboard_types::{Key, KeyboardEvent, Modifiers, ShortcutMatcher};
    /// # fn copy() {}
    /// # fn quit() {}
    /// # let event = KeyboardEvent {
    /// #     state: keyboard_types::KeyState::Down,
    /// #     key: Key::Enter,
    /// #     code: keyboard_types::Code::Enter,
    /// #     location: keyboard_types::Location::Standard,
    /// #     modifiers: Modifiers::empty(),
    /// #     repeat: false,
    /// #     is_composing: false,
    /// # };
    /// ShortcutMatcher::from_event(event)
    /// .shortcut(Modifiers::CONTROL, 'c', copy)
    /// .optional_shortcut(cfg!(target_os="macos"), Modifiers::META, 'q', quit)
    /// .shortcut(Modifiers::CONTROL, 'w', quit);
    /// ```
    ///
    /// In the example the app supports the copy action on all platforms
    /// and can be closed with Control&nbsp;+&nbsp;W everywhere but additionally
    /// with Command&nbsp;+&nbsp;Q on Mac OS.
    pub fn optional_shortcut<K, F>(
        self,
        enabled: bool,
        modifiers: Modifiers,
        key: K,
        f: F,
    ) -> ShortcutMatcher<T>
    where
        K: MatchKey,
        F: (FnOnce() -> T),
    {
        if !enabled {
            return self;
        }
        self.shortcut(modifiers, key, f)
    }

    /// Execute the function is no keyboard shortcut matched.
    ///
    /// Note that the passed function is executed on both
    /// keydown and keyup unlike the shortcuts which only
    /// run on keydown.
    pub fn otherwise<F>(self, f: F) -> Option<T>
    where
        F: (FnOnce() -> T),
    {
        if !self.matched {
            Some(f())
        } else {
            self.value
        }
    }
}

pub trait MatchKey {
    fn match_key(&self, key: &Key) -> bool;
}

impl MatchKey for Key {
    fn match_key(&self, key: &Key) -> bool {
        self == key
    }
}

impl MatchKey for char {
    fn match_key(&self, key: &Key) -> bool {
        match key {
            Key::Character(text) => {
                let mut buf = [0; 4];
                text.eq_ignore_ascii_case(self.encode_utf8(&mut buf))
            }
            _ => false,
        }
    }
}
