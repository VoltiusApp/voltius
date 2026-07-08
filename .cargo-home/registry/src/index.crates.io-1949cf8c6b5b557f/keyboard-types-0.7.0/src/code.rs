
// AUTO GENERATED CODE - DO NOT EDIT
#![cfg_attr(rustfmt, rustfmt_skip)]

use std::fmt::{self, Display};
use std::str::FromStr;
use std::error::Error;

/// Code is the physical position of a key.
///
/// The names are based on the US keyboard. If the key
/// is not present on US keyboards a name from another
/// layout is used.
///
/// Specification:
/// <https://w3c.github.io/uievents-code/>
#[derive(Copy, Clone, Debug, Eq, PartialEq, Hash)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[non_exhaustive]
pub enum Code {
    /// <code class="keycap">`~</code> on a US keyboard. This is the <code class="keycap">半角/全角/漢字</code> (<span class="unicode">hankaku/zenkaku/kanji</span>) key on Japanese keyboards
    Backquote,
    /// Used for both the US <code class="keycap">\|</code> (on the 101-key layout) and also for the key
    /// located between the <code class="keycap">"</code> and <code class="keycap">Enter</code> keys on row C of the 102-,
    /// 104- and 106-key layouts.
    /// Labelled <code class="keycap">#~</code> on a UK (102) keyboard.
    Backslash,
    /// <code class="keycap">[{</code> on a US keyboard.
    BracketLeft,
    /// <code class="keycap">]}</code> on a US keyboard.
    BracketRight,
    /// <code class="keycap">,&lt;</code> on a US keyboard.
    Comma,
    /// <code class="keycap">0)</code> on a US keyboard.
    Digit0,
    /// <code class="keycap">1!</code> on a US keyboard.
    Digit1,
    /// <code class="keycap">2@</code> on a US keyboard.
    Digit2,
    /// <code class="keycap">3#</code> on a US keyboard.
    Digit3,
    /// <code class="keycap">4$</code> on a US keyboard.
    Digit4,
    /// <code class="keycap">5%</code> on a US keyboard.
    Digit5,
    /// <code class="keycap">6^</code> on a US keyboard.
    Digit6,
    /// <code class="keycap">7&amp;</code> on a US keyboard.
    Digit7,
    /// <code class="keycap">8*</code> on a US keyboard.
    Digit8,
    /// <code class="keycap">9(</code> on a US keyboard.
    Digit9,
    /// <code class="keycap">=+</code> on a US keyboard.
    Equal,
    /// Located between the left <code class="keycap">Shift</code> and <code class="keycap">Z</code> keys.
    /// Labelled <code class="keycap">\|</code> on a UK keyboard.
    IntlBackslash,
    /// Located between the <code class="keycap">/</code> and right <code class="keycap">Shift</code> keys.
    /// Labelled <code class="keycap">\ろ</code> (<span class="unicode">ro</span>) on a Japanese keyboard.
    IntlRo,
    /// Located between the <code class="keycap">=</code> and <code class="keycap">Backspace</code> keys.
    /// Labelled <code class="keycap">¥</code> (<span class="unicode">yen</span>) on a Japanese keyboard. <code class="keycap">\/</code> on a
    /// Russian keyboard.
    IntlYen,
    /// <code class="keycap">a</code> on a US keyboard.
    /// Labelled <code class="keycap">q</code> on an AZERTY (e.g., French) keyboard.
    KeyA,
    /// <code class="keycap">b</code> on a US keyboard.
    KeyB,
    /// <code class="keycap">c</code> on a US keyboard.
    KeyC,
    /// <code class="keycap">d</code> on a US keyboard.
    KeyD,
    /// <code class="keycap">e</code> on a US keyboard.
    KeyE,
    /// <code class="keycap">f</code> on a US keyboard.
    KeyF,
    /// <code class="keycap">g</code> on a US keyboard.
    KeyG,
    /// <code class="keycap">h</code> on a US keyboard.
    KeyH,
    /// <code class="keycap">i</code> on a US keyboard.
    KeyI,
    /// <code class="keycap">j</code> on a US keyboard.
    KeyJ,
    /// <code class="keycap">k</code> on a US keyboard.
    KeyK,
    /// <code class="keycap">l</code> on a US keyboard.
    KeyL,
    /// <code class="keycap">m</code> on a US keyboard.
    KeyM,
    /// <code class="keycap">n</code> on a US keyboard.
    KeyN,
    /// <code class="keycap">o</code> on a US keyboard.
    KeyO,
    /// <code class="keycap">p</code> on a US keyboard.
    KeyP,
    /// <code class="keycap">q</code> on a US keyboard.
    /// Labelled <code class="keycap">a</code> on an AZERTY (e.g., French) keyboard.
    KeyQ,
    /// <code class="keycap">r</code> on a US keyboard.
    KeyR,
    /// <code class="keycap">s</code> on a US keyboard.
    KeyS,
    /// <code class="keycap">t</code> on a US keyboard.
    KeyT,
    /// <code class="keycap">u</code> on a US keyboard.
    KeyU,
    /// <code class="keycap">v</code> on a US keyboard.
    KeyV,
    /// <code class="keycap">w</code> on a US keyboard.
    /// Labelled <code class="keycap">z</code> on an AZERTY (e.g., French) keyboard.
    KeyW,
    /// <code class="keycap">x</code> on a US keyboard.
    KeyX,
    /// <code class="keycap">y</code> on a US keyboard.
    /// Labelled <code class="keycap">z</code> on a QWERTZ (e.g., German) keyboard.
    KeyY,
    /// <code class="keycap">z</code> on a US keyboard.
    /// Labelled <code class="keycap">w</code> on an AZERTY (e.g., French) keyboard, and <code class="keycap">y</code> on a
    /// QWERTZ (e.g., German) keyboard.
    KeyZ,
    /// <code class="keycap">-_</code> on a US keyboard.
    Minus,
    /// <code class="keycap">.></code> on a US keyboard.
    Period,
    /// <code class="keycap">'"</code> on a US keyboard.
    Quote,
    /// <code class="keycap">;:</code> on a US keyboard.
    Semicolon,
    /// <code class="keycap">/?</code> on a US keyboard.
    Slash,
    /// <code class="keycap">Alt</code>, <code class="keycap">Option</code> or <code class="keycap">⌥</code>.
    AltLeft,
    /// <code class="keycap">Alt</code>, <code class="keycap">Option</code> or <code class="keycap">⌥</code>.
    /// This is labelled <code class="keycap">AltGr</code> key on many keyboard layouts.
    AltRight,
    /// <code class="keycap">Backspace</code> or <code class="keycap">⌫</code>.
    /// Labelled <code class="keycap">Delete</code> on Apple keyboards.
    Backspace,
    /// <code class="keycap">CapsLock</code> or <code class="keycap">⇪</code>
    CapsLock,
    /// The application context menu key, which is typically found between the right <code class="keycap">Meta</code> key and the right <code class="keycap">Control</code> key.
    ContextMenu,
    /// <code class="keycap">Control</code> or <code class="keycap">⌃</code>
    ControlLeft,
    /// <code class="keycap">Control</code> or <code class="keycap">⌃</code>
    ControlRight,
    /// <code class="keycap">Enter</code> or <code class="keycap">↵</code>. Labelled <code class="keycap">Return</code> on Apple keyboards.
    Enter,
    /// The Windows, <code class="keycap">⌘</code>, <code class="keycap">Command</code> or other OS symbol key.
    MetaLeft,
    /// The Windows, <code class="keycap">⌘</code>, <code class="keycap">Command</code> or other OS symbol key.
    MetaRight,
    /// <code class="keycap">Shift</code> or <code class="keycap">⇧</code>
    ShiftLeft,
    /// <code class="keycap">Shift</code> or <code class="keycap">⇧</code>
    ShiftRight,
    /// <code class="keycap"> </code> (space)
    Space,
    /// <code class="keycap">Tab</code> or <code class="keycap">⇥</code>
    Tab,
    /// Japanese: <code class="keycap">変換</code> (<span class="unicode">henkan</span>)
    Convert,
    /// Japanese: <code class="keycap">カタカナ/ひらがな/ローマ字</code> (<span class="unicode">katakana/hiragana/romaji</span>)
    KanaMode,
    /// Korean: HangulMode <code class="keycap">한/영</code> (<span class="unicode">han/yeong</span>)<br>Japanese (Mac keyboard): <code class="keycap">かな</code> (<span class="unicode">kana</span>)
    Lang1,
    /// Korean: Hanja <code class="keycap">한자</code> (<span class="unicode">hanja</span>)<br>Japanese (Mac keyboard): <code class="keycap">英数</code> (<span class="unicode">eisu</span>)
    Lang2,
    /// Japanese (word-processing keyboard): Katakana
    Lang3,
    /// Japanese (word-processing keyboard): Hiragana
    Lang4,
    /// Japanese (word-processing keyboard): Zenkaku/Hankaku
    Lang5,
    /// Japanese: <code class="keycap">無変換</code> (<span class="unicode">muhenkan</span>)
    NonConvert,
    /// <code class="keycap">⌦</code>. The forward delete key.
    /// Note that on Apple keyboards, the key labelled <code class="keycap">Delete</code> on the main part of
    /// the keyboard should be encoded as <code class="code">"Backspace"</code>.
    Delete,
    /// <code class="keycap">End</code> or <code class="keycap">↘</code>
    End,
    /// <code class="keycap">Help</code>. Not present on standard PC keyboards.
    Help,
    /// <code class="keycap">Home</code> or <code class="keycap">↖</code>
    Home,
    /// <code class="keycap">Insert</code> or <code class="keycap">Ins</code>. Not present on Apple keyboards.
    Insert,
    /// <code class="keycap">Page Down</code>, <code class="keycap">PgDn</code> or <code class="keycap">⇟</code>
    PageDown,
    /// <code class="keycap">Page Up</code>, <code class="keycap">PgUp</code> or <code class="keycap">⇞</code>
    PageUp,
    /// <code class="keycap">↓</code>
    ArrowDown,
    /// <code class="keycap">←</code>
    ArrowLeft,
    /// <code class="keycap">→</code>
    ArrowRight,
    /// <code class="keycap">↑</code>
    ArrowUp,
    /// On the Mac, the <code class="code">"NumLock"</code> code should be used for the numpad <code class="keycap">Clear</code> key.
    NumLock,
    /// <code class="keycap">0 Ins</code> on a keyboard<br><code class="keycap">0</code> on a phone or remote control
    Numpad0,
    /// <code class="keycap">1 End</code> on a keyboard<br><code class="keycap">1</code> or <code class="keycap">1 QZ</code> on a phone or
    /// remote control
    Numpad1,
    /// <code class="keycap">2 ↓</code> on a keyboard<br><code class="keycap">2 ABC</code> on a phone or remote control
    Numpad2,
    /// <code class="keycap">3 PgDn</code> on a keyboard<br><code class="keycap">3 DEF</code> on a phone or remote control
    Numpad3,
    /// <code class="keycap">4 ←</code> on a keyboard<br><code class="keycap">4 GHI</code> on a phone or remote control
    Numpad4,
    /// <code class="keycap">5</code> on a keyboard<br><code class="keycap">5 JKL</code> on a phone or remote control
    Numpad5,
    /// <code class="keycap">6 →</code> on a keyboard<br><code class="keycap">6 MNO</code> on a phone or remote control
    Numpad6,
    /// <code class="keycap">7 Home</code> on a keyboard<br><code class="keycap">7 PQRS</code> or <code class="keycap">7 PRS</code> on a phone
    /// or remote control
    Numpad7,
    /// <code class="keycap">8 ↑</code> on a keyboard<br><code class="keycap">8 TUV</code> on a phone or remote control
    Numpad8,
    /// <code class="keycap">9 PgUp</code> on a keyboard<br><code class="keycap">9 WXYZ</code> or <code class="keycap">9 WXY</code> on a phone
    /// or remote control
    Numpad9,
    /// <code class="keycap">+</code>
    NumpadAdd,
    /// Found on the Microsoft Natural Keyboard.
    NumpadBackspace,
    /// <code class="keycap">C</code> or <code class="keycap">AC</code> (All Clear). Also for use with numpads that have a <code class="keycap">Clear</code> key that is separate from the <code class="keycap">NumLock</code> key. On the Mac, the numpad <code class="keycap">Clear</code> key should always
    /// be encoded as <code class="code">"NumLock"</code>.
    NumpadClear,
    /// <code class="keycap">CE</code> (Clear Entry)
    NumpadClearEntry,
    /// <code class="keycap">,</code> (thousands separator). For locales where the thousands separator
    /// is a "." (e.g., Brazil), this key may generate a <code class="keycap">.</code>.
    NumpadComma,
    /// <code class="keycap">. Del</code>. For locales where the decimal separator is "," (e.g.,
    /// Brazil), this key may generate a <code class="keycap">,</code>.
    NumpadDecimal,
    /// <code class="keycap">/</code>
    NumpadDivide,
    NumpadEnter,
    /// <code class="keycap">=</code>
    NumpadEqual,
    /// <code class="keycap">#</code> on a phone or remote control device. This key is typically found
    /// below the <code class="keycap">9</code> key and to the right of the <code class="keycap">0</code> key.
    NumpadHash,
    /// <code class="keycap">M+</code> Add current entry to the value stored in memory.
    NumpadMemoryAdd,
    /// <code class="keycap">MC</code> Clear the value stored in memory.
    NumpadMemoryClear,
    /// <code class="keycap">MR</code> Replace the current entry with the value stored in memory.
    NumpadMemoryRecall,
    /// <code class="keycap">MS</code> Replace the value stored in memory with the current entry.
    NumpadMemoryStore,
    /// <code class="keycap">M-</code> Subtract current entry from the value stored in memory.
    NumpadMemorySubtract,
    /// <code class="keycap">*</code> on a keyboard. For use with numpads that provide mathematical
    /// operations (<code class="keycap">+</code>, <code class="keycap">-</code>, <code class="keycap">*</code> and <code class="keycap">/</code>).<br>Use <code class="code">"NumpadStar"</code> for the <code class="keycap">*</code> key on phones and remote controls.
    NumpadMultiply,
    /// <code class="keycap">(</code> Found on the Microsoft Natural Keyboard.
    NumpadParenLeft,
    /// <code class="keycap">)</code> Found on the Microsoft Natural Keyboard.
    NumpadParenRight,
    /// <code class="keycap">*</code> on a phone or remote control device.
    /// This key is typically found below the <code class="keycap">7</code> key and to the left of
    /// the <code class="keycap">0</code> key.<br>Use <code class="code">"NumpadMultiply"</code> for the <code class="keycap">*</code> key on
    /// numeric keypads.
    NumpadStar,
    /// <code class="keycap">-</code>
    NumpadSubtract,
    /// <code class="keycap">Esc</code> or <code class="keycap">⎋</code>
    Escape,
    /// <code class="keycap">Fn</code> This is typically a hardware key that does not generate a separate
    /// code. Most keyboards do not place this key in the function section, but it is
    /// included here to keep it with related keys.
    Fn,
    /// <code class="keycap">FLock</code> or <code class="keycap">FnLock</code>. Function Lock key. Found on the Microsoft
    /// Natural Keyboard.
    FnLock,
    /// <code class="keycap">PrtScr SysRq</code> or <code class="keycap">Print Screen</code>
    PrintScreen,
    /// <code class="keycap">Scroll Lock</code>
    ScrollLock,
    /// <code class="keycap">Pause Break</code>
    Pause,
    /// Some laptops place this key to the left of the <code class="keycap">↑</code> key.
    BrowserBack,
    BrowserFavorites,
    /// Some laptops place this key to the right of the <code class="keycap">↑</code> key.
    BrowserForward,
    BrowserHome,
    BrowserRefresh,
    BrowserSearch,
    BrowserStop,
    /// <code class="keycap">Eject</code> or <code class="keycap">⏏</code>. This key is placed in the <a data-link-type="dfn" href="#function-section" id="ref-for-function-section①①">function
    /// section</a> on some Apple keyboards.
    Eject,
    /// Sometimes labelled <code class="keycap">My Computer</code> on the keyboard
    LaunchApp1,
    /// Sometimes labelled <code class="keycap">Calculator</code> on the keyboard
    LaunchApp2,
    LaunchMail,
    MediaPlayPause,
    MediaSelect,
    MediaStop,
    MediaTrackNext,
    MediaTrackPrevious,
    /// This key is placed in the function section on some Apple keyboards,
    /// replacing the <code class="keycap">Eject</code> key.
    Power,
    Sleep,
    AudioVolumeDown,
    AudioVolumeMute,
    AudioVolumeUp,
    WakeUp,
    Hyper,
    Super,
    Turbo,
    Abort,
    Resume,
    Suspend,
    /// Found on Sun’s USB keyboard.
    Again,
    /// Found on Sun’s USB keyboard.
    Copy,
    /// Found on Sun’s USB keyboard.
    Cut,
    /// Found on Sun’s USB keyboard.
    Find,
    /// Found on Sun’s USB keyboard.
    Open,
    /// Found on Sun’s USB keyboard.
    Paste,
    /// Found on Sun’s USB keyboard.
    Props,
    /// Found on Sun’s USB keyboard.
    Select,
    /// Found on Sun’s USB keyboard.
    Undo,
    /// Use for dedicated <code class="keycap">ひらがな</code> key found on some Japanese word processing keyboards.
    Hiragana,
    /// Use for dedicated <code class="keycap">カタカナ</code> key found on some Japanese word processing keyboards.
    Katakana,
    /// This value code should be used when no other
    /// value given in this specification is appropriate.
    Unidentified,
    /// <code class="keycap">F1</code>
    F1,
    /// <code class="keycap">F2</code>
    F2,
    /// <code class="keycap">F3</code>
    F3,
    /// <code class="keycap">F4</code>
    F4,
    /// <code class="keycap">F5</code>
    F5,
    /// <code class="keycap">F6</code>
    F6,
    /// <code class="keycap">F7</code>
    F7,
    /// <code class="keycap">F8</code>
    F8,
    /// <code class="keycap">F9</code>
    F9,
    /// <code class="keycap">F10</code>
    F10,
    /// <code class="keycap">F11</code>
    F11,
    /// <code class="keycap">F12</code>
    F12,
    /// <code class="keycap">F13</code>
    F13,
    /// <code class="keycap">F14</code>
    F14,
    /// <code class="keycap">F15</code>
    F15,
    /// <code class="keycap">F16</code>
    F16,
    /// <code class="keycap">F17</code>
    F17,
    /// <code class="keycap">F18</code>
    F18,
    /// <code class="keycap">F19</code>
    F19,
    /// <code class="keycap">F20</code>
    F20,
    /// <code class="keycap">F21</code>
    F21,
    /// <code class="keycap">F22</code>
    F22,
    /// <code class="keycap">F23</code>
    F23,
    /// <code class="keycap">F24</code>
    F24,
    /// <code class="keycap">F25</code>
    F25,
    /// <code class="keycap">F26</code>
    F26,
    /// <code class="keycap">F27</code>
    F27,
    /// <code class="keycap">F28</code>
    F28,
    /// <code class="keycap">F29</code>
    F29,
    /// <code class="keycap">F30</code>
    F30,
    /// <code class="keycap">F31</code>
    F31,
    /// <code class="keycap">F32</code>
    F32,
    /// <code class="keycap">F33</code>
    F33,
    /// <code class="keycap">F34</code>
    F34,
    /// <code class="keycap">F35</code>
    F35,
    /// Non-standard code value supported by Chromium.
    BrightnessDown,
    /// Non-standard code value supported by Chromium.
    BrightnessUp,
    /// Non-standard code value supported by Chromium.
    DisplayToggleIntExt,
    /// Non-standard code value supported by Chromium.
    KeyboardLayoutSelect,
    /// Non-standard code value supported by Chromium.
    LaunchAssistant,
    /// Non-standard code value supported by Chromium.
    LaunchControlPanel,
    /// Non-standard code value supported by Chromium.
    LaunchScreenSaver,
    /// Non-standard code value supported by Chromium.
    MailForward,
    /// Non-standard code value supported by Chromium.
    MailReply,
    /// Non-standard code value supported by Chromium.
    MailSend,
    /// Non-standard code value supported by Chromium.
    MediaFastForward,
    /// Non-standard code value supported by Chromium.
    MediaPause,
    /// Non-standard code value supported by Chromium.
    MediaPlay,
    /// Non-standard code value supported by Chromium.
    MediaRecord,
    /// Non-standard code value supported by Chromium.
    MediaRewind,
    /// Non-standard code value supported by Chromium.
    MicrophoneMuteToggle,
    /// Non-standard code value supported by Chromium.
    PrivacyScreenToggle,
    /// Non-standard code value supported by Chromium.
    SelectTask,
    /// Non-standard code value supported by Chromium.
    ShowAllWindows,
    /// Non-standard code value supported by Chromium.
    ZoomToggle,
}


impl Display for Code {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        use self::Code::*;
        match *self {
    
            Backquote => f.write_str("Backquote"),
            Backslash => f.write_str("Backslash"),
            BracketLeft => f.write_str("BracketLeft"),
            BracketRight => f.write_str("BracketRight"),
            Comma => f.write_str("Comma"),
            Digit0 => f.write_str("Digit0"),
            Digit1 => f.write_str("Digit1"),
            Digit2 => f.write_str("Digit2"),
            Digit3 => f.write_str("Digit3"),
            Digit4 => f.write_str("Digit4"),
            Digit5 => f.write_str("Digit5"),
            Digit6 => f.write_str("Digit6"),
            Digit7 => f.write_str("Digit7"),
            Digit8 => f.write_str("Digit8"),
            Digit9 => f.write_str("Digit9"),
            Equal => f.write_str("Equal"),
            IntlBackslash => f.write_str("IntlBackslash"),
            IntlRo => f.write_str("IntlRo"),
            IntlYen => f.write_str("IntlYen"),
            KeyA => f.write_str("KeyA"),
            KeyB => f.write_str("KeyB"),
            KeyC => f.write_str("KeyC"),
            KeyD => f.write_str("KeyD"),
            KeyE => f.write_str("KeyE"),
            KeyF => f.write_str("KeyF"),
            KeyG => f.write_str("KeyG"),
            KeyH => f.write_str("KeyH"),
            KeyI => f.write_str("KeyI"),
            KeyJ => f.write_str("KeyJ"),
            KeyK => f.write_str("KeyK"),
            KeyL => f.write_str("KeyL"),
            KeyM => f.write_str("KeyM"),
            KeyN => f.write_str("KeyN"),
            KeyO => f.write_str("KeyO"),
            KeyP => f.write_str("KeyP"),
            KeyQ => f.write_str("KeyQ"),
            KeyR => f.write_str("KeyR"),
            KeyS => f.write_str("KeyS"),
            KeyT => f.write_str("KeyT"),
            KeyU => f.write_str("KeyU"),
            KeyV => f.write_str("KeyV"),
            KeyW => f.write_str("KeyW"),
            KeyX => f.write_str("KeyX"),
            KeyY => f.write_str("KeyY"),
            KeyZ => f.write_str("KeyZ"),
            Minus => f.write_str("Minus"),
            Period => f.write_str("Period"),
            Quote => f.write_str("Quote"),
            Semicolon => f.write_str("Semicolon"),
            Slash => f.write_str("Slash"),
            AltLeft => f.write_str("AltLeft"),
            AltRight => f.write_str("AltRight"),
            Backspace => f.write_str("Backspace"),
            CapsLock => f.write_str("CapsLock"),
            ContextMenu => f.write_str("ContextMenu"),
            ControlLeft => f.write_str("ControlLeft"),
            ControlRight => f.write_str("ControlRight"),
            Enter => f.write_str("Enter"),
            MetaLeft => f.write_str("MetaLeft"),
            MetaRight => f.write_str("MetaRight"),
            ShiftLeft => f.write_str("ShiftLeft"),
            ShiftRight => f.write_str("ShiftRight"),
            Space => f.write_str("Space"),
            Tab => f.write_str("Tab"),
            Convert => f.write_str("Convert"),
            KanaMode => f.write_str("KanaMode"),
            Lang1 => f.write_str("Lang1"),
            Lang2 => f.write_str("Lang2"),
            Lang3 => f.write_str("Lang3"),
            Lang4 => f.write_str("Lang4"),
            Lang5 => f.write_str("Lang5"),
            NonConvert => f.write_str("NonConvert"),
            Delete => f.write_str("Delete"),
            End => f.write_str("End"),
            Help => f.write_str("Help"),
            Home => f.write_str("Home"),
            Insert => f.write_str("Insert"),
            PageDown => f.write_str("PageDown"),
            PageUp => f.write_str("PageUp"),
            ArrowDown => f.write_str("ArrowDown"),
            ArrowLeft => f.write_str("ArrowLeft"),
            ArrowRight => f.write_str("ArrowRight"),
            ArrowUp => f.write_str("ArrowUp"),
            NumLock => f.write_str("NumLock"),
            Numpad0 => f.write_str("Numpad0"),
            Numpad1 => f.write_str("Numpad1"),
            Numpad2 => f.write_str("Numpad2"),
            Numpad3 => f.write_str("Numpad3"),
            Numpad4 => f.write_str("Numpad4"),
            Numpad5 => f.write_str("Numpad5"),
            Numpad6 => f.write_str("Numpad6"),
            Numpad7 => f.write_str("Numpad7"),
            Numpad8 => f.write_str("Numpad8"),
            Numpad9 => f.write_str("Numpad9"),
            NumpadAdd => f.write_str("NumpadAdd"),
            NumpadBackspace => f.write_str("NumpadBackspace"),
            NumpadClear => f.write_str("NumpadClear"),
            NumpadClearEntry => f.write_str("NumpadClearEntry"),
            NumpadComma => f.write_str("NumpadComma"),
            NumpadDecimal => f.write_str("NumpadDecimal"),
            NumpadDivide => f.write_str("NumpadDivide"),
            NumpadEnter => f.write_str("NumpadEnter"),
            NumpadEqual => f.write_str("NumpadEqual"),
            NumpadHash => f.write_str("NumpadHash"),
            NumpadMemoryAdd => f.write_str("NumpadMemoryAdd"),
            NumpadMemoryClear => f.write_str("NumpadMemoryClear"),
            NumpadMemoryRecall => f.write_str("NumpadMemoryRecall"),
            NumpadMemoryStore => f.write_str("NumpadMemoryStore"),
            NumpadMemorySubtract => f.write_str("NumpadMemorySubtract"),
            NumpadMultiply => f.write_str("NumpadMultiply"),
            NumpadParenLeft => f.write_str("NumpadParenLeft"),
            NumpadParenRight => f.write_str("NumpadParenRight"),
            NumpadStar => f.write_str("NumpadStar"),
            NumpadSubtract => f.write_str("NumpadSubtract"),
            Escape => f.write_str("Escape"),
            Fn => f.write_str("Fn"),
            FnLock => f.write_str("FnLock"),
            PrintScreen => f.write_str("PrintScreen"),
            ScrollLock => f.write_str("ScrollLock"),
            Pause => f.write_str("Pause"),
            BrowserBack => f.write_str("BrowserBack"),
            BrowserFavorites => f.write_str("BrowserFavorites"),
            BrowserForward => f.write_str("BrowserForward"),
            BrowserHome => f.write_str("BrowserHome"),
            BrowserRefresh => f.write_str("BrowserRefresh"),
            BrowserSearch => f.write_str("BrowserSearch"),
            BrowserStop => f.write_str("BrowserStop"),
            Eject => f.write_str("Eject"),
            LaunchApp1 => f.write_str("LaunchApp1"),
            LaunchApp2 => f.write_str("LaunchApp2"),
            LaunchMail => f.write_str("LaunchMail"),
            MediaPlayPause => f.write_str("MediaPlayPause"),
            MediaSelect => f.write_str("MediaSelect"),
            MediaStop => f.write_str("MediaStop"),
            MediaTrackNext => f.write_str("MediaTrackNext"),
            MediaTrackPrevious => f.write_str("MediaTrackPrevious"),
            Power => f.write_str("Power"),
            Sleep => f.write_str("Sleep"),
            AudioVolumeDown => f.write_str("AudioVolumeDown"),
            AudioVolumeMute => f.write_str("AudioVolumeMute"),
            AudioVolumeUp => f.write_str("AudioVolumeUp"),
            WakeUp => f.write_str("WakeUp"),
            Hyper => f.write_str("Hyper"),
            Super => f.write_str("Super"),
            Turbo => f.write_str("Turbo"),
            Abort => f.write_str("Abort"),
            Resume => f.write_str("Resume"),
            Suspend => f.write_str("Suspend"),
            Again => f.write_str("Again"),
            Copy => f.write_str("Copy"),
            Cut => f.write_str("Cut"),
            Find => f.write_str("Find"),
            Open => f.write_str("Open"),
            Paste => f.write_str("Paste"),
            Props => f.write_str("Props"),
            Select => f.write_str("Select"),
            Undo => f.write_str("Undo"),
            Hiragana => f.write_str("Hiragana"),
            Katakana => f.write_str("Katakana"),
            Unidentified => f.write_str("Unidentified"),
            F1 => f.write_str("F1"),
            F2 => f.write_str("F2"),
            F3 => f.write_str("F3"),
            F4 => f.write_str("F4"),
            F5 => f.write_str("F5"),
            F6 => f.write_str("F6"),
            F7 => f.write_str("F7"),
            F8 => f.write_str("F8"),
            F9 => f.write_str("F9"),
            F10 => f.write_str("F10"),
            F11 => f.write_str("F11"),
            F12 => f.write_str("F12"),
            F13 => f.write_str("F13"),
            F14 => f.write_str("F14"),
            F15 => f.write_str("F15"),
            F16 => f.write_str("F16"),
            F17 => f.write_str("F17"),
            F18 => f.write_str("F18"),
            F19 => f.write_str("F19"),
            F20 => f.write_str("F20"),
            F21 => f.write_str("F21"),
            F22 => f.write_str("F22"),
            F23 => f.write_str("F23"),
            F24 => f.write_str("F24"),
            F25 => f.write_str("F25"),
            F26 => f.write_str("F26"),
            F27 => f.write_str("F27"),
            F28 => f.write_str("F28"),
            F29 => f.write_str("F29"),
            F30 => f.write_str("F30"),
            F31 => f.write_str("F31"),
            F32 => f.write_str("F32"),
            F33 => f.write_str("F33"),
            F34 => f.write_str("F34"),
            F35 => f.write_str("F35"),
            BrightnessDown => f.write_str("BrightnessDown"),
            BrightnessUp => f.write_str("BrightnessUp"),
            DisplayToggleIntExt => f.write_str("DisplayToggleIntExt"),
            KeyboardLayoutSelect => f.write_str("KeyboardLayoutSelect"),
            LaunchAssistant => f.write_str("LaunchAssistant"),
            LaunchControlPanel => f.write_str("LaunchControlPanel"),
            LaunchScreenSaver => f.write_str("LaunchScreenSaver"),
            MailForward => f.write_str("MailForward"),
            MailReply => f.write_str("MailReply"),
            MailSend => f.write_str("MailSend"),
            MediaFastForward => f.write_str("MediaFastForward"),
            MediaPause => f.write_str("MediaPause"),
            MediaPlay => f.write_str("MediaPlay"),
            MediaRecord => f.write_str("MediaRecord"),
            MediaRewind => f.write_str("MediaRewind"),
            MicrophoneMuteToggle => f.write_str("MicrophoneMuteToggle"),
            PrivacyScreenToggle => f.write_str("PrivacyScreenToggle"),
            SelectTask => f.write_str("SelectTask"),
            ShowAllWindows => f.write_str("ShowAllWindows"),
            ZoomToggle => f.write_str("ZoomToggle"),

        }
    }
}

impl FromStr for Code {
    type Err = UnrecognizedCodeError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        use crate::Code::*;
        match s {
            "Backquote" => Ok(Backquote),
            "Backslash" => Ok(Backslash),
            "BracketLeft" => Ok(BracketLeft),
            "BracketRight" => Ok(BracketRight),
            "Comma" => Ok(Comma),
            "Digit0" => Ok(Digit0),
            "Digit1" => Ok(Digit1),
            "Digit2" => Ok(Digit2),
            "Digit3" => Ok(Digit3),
            "Digit4" => Ok(Digit4),
            "Digit5" => Ok(Digit5),
            "Digit6" => Ok(Digit6),
            "Digit7" => Ok(Digit7),
            "Digit8" => Ok(Digit8),
            "Digit9" => Ok(Digit9),
            "Equal" => Ok(Equal),
            "IntlBackslash" => Ok(IntlBackslash),
            "IntlRo" => Ok(IntlRo),
            "IntlYen" => Ok(IntlYen),
            "KeyA" => Ok(KeyA),
            "KeyB" => Ok(KeyB),
            "KeyC" => Ok(KeyC),
            "KeyD" => Ok(KeyD),
            "KeyE" => Ok(KeyE),
            "KeyF" => Ok(KeyF),
            "KeyG" => Ok(KeyG),
            "KeyH" => Ok(KeyH),
            "KeyI" => Ok(KeyI),
            "KeyJ" => Ok(KeyJ),
            "KeyK" => Ok(KeyK),
            "KeyL" => Ok(KeyL),
            "KeyM" => Ok(KeyM),
            "KeyN" => Ok(KeyN),
            "KeyO" => Ok(KeyO),
            "KeyP" => Ok(KeyP),
            "KeyQ" => Ok(KeyQ),
            "KeyR" => Ok(KeyR),
            "KeyS" => Ok(KeyS),
            "KeyT" => Ok(KeyT),
            "KeyU" => Ok(KeyU),
            "KeyV" => Ok(KeyV),
            "KeyW" => Ok(KeyW),
            "KeyX" => Ok(KeyX),
            "KeyY" => Ok(KeyY),
            "KeyZ" => Ok(KeyZ),
            "Minus" => Ok(Minus),
            "Period" => Ok(Period),
            "Quote" => Ok(Quote),
            "Semicolon" => Ok(Semicolon),
            "Slash" => Ok(Slash),
            "AltLeft" => Ok(AltLeft),
            "AltRight" => Ok(AltRight),
            "Backspace" => Ok(Backspace),
            "CapsLock" => Ok(CapsLock),
            "ContextMenu" => Ok(ContextMenu),
            "ControlLeft" => Ok(ControlLeft),
            "ControlRight" => Ok(ControlRight),
            "Enter" => Ok(Enter),
            "MetaLeft" | "OSLeft" => Ok(MetaLeft),
            "MetaRight" | "OSRight" => Ok(MetaRight),
            "ShiftLeft" => Ok(ShiftLeft),
            "ShiftRight" => Ok(ShiftRight),
            "Space" => Ok(Space),
            "Tab" => Ok(Tab),
            "Convert" => Ok(Convert),
            "KanaMode" => Ok(KanaMode),
            "Lang1" => Ok(Lang1),
            "Lang2" => Ok(Lang2),
            "Lang3" => Ok(Lang3),
            "Lang4" => Ok(Lang4),
            "Lang5" => Ok(Lang5),
            "NonConvert" => Ok(NonConvert),
            "Delete" => Ok(Delete),
            "End" => Ok(End),
            "Help" => Ok(Help),
            "Home" => Ok(Home),
            "Insert" => Ok(Insert),
            "PageDown" => Ok(PageDown),
            "PageUp" => Ok(PageUp),
            "ArrowDown" => Ok(ArrowDown),
            "ArrowLeft" => Ok(ArrowLeft),
            "ArrowRight" => Ok(ArrowRight),
            "ArrowUp" => Ok(ArrowUp),
            "NumLock" => Ok(NumLock),
            "Numpad0" => Ok(Numpad0),
            "Numpad1" => Ok(Numpad1),
            "Numpad2" => Ok(Numpad2),
            "Numpad3" => Ok(Numpad3),
            "Numpad4" => Ok(Numpad4),
            "Numpad5" => Ok(Numpad5),
            "Numpad6" => Ok(Numpad6),
            "Numpad7" => Ok(Numpad7),
            "Numpad8" => Ok(Numpad8),
            "Numpad9" => Ok(Numpad9),
            "NumpadAdd" => Ok(NumpadAdd),
            "NumpadBackspace" => Ok(NumpadBackspace),
            "NumpadClear" => Ok(NumpadClear),
            "NumpadClearEntry" => Ok(NumpadClearEntry),
            "NumpadComma" => Ok(NumpadComma),
            "NumpadDecimal" => Ok(NumpadDecimal),
            "NumpadDivide" => Ok(NumpadDivide),
            "NumpadEnter" => Ok(NumpadEnter),
            "NumpadEqual" => Ok(NumpadEqual),
            "NumpadHash" => Ok(NumpadHash),
            "NumpadMemoryAdd" => Ok(NumpadMemoryAdd),
            "NumpadMemoryClear" => Ok(NumpadMemoryClear),
            "NumpadMemoryRecall" => Ok(NumpadMemoryRecall),
            "NumpadMemoryStore" => Ok(NumpadMemoryStore),
            "NumpadMemorySubtract" => Ok(NumpadMemorySubtract),
            "NumpadMultiply" => Ok(NumpadMultiply),
            "NumpadParenLeft" => Ok(NumpadParenLeft),
            "NumpadParenRight" => Ok(NumpadParenRight),
            "NumpadStar" => Ok(NumpadStar),
            "NumpadSubtract" => Ok(NumpadSubtract),
            "Escape" => Ok(Escape),
            "Fn" => Ok(Fn),
            "FnLock" => Ok(FnLock),
            "PrintScreen" => Ok(PrintScreen),
            "ScrollLock" => Ok(ScrollLock),
            "Pause" => Ok(Pause),
            "BrowserBack" => Ok(BrowserBack),
            "BrowserFavorites" => Ok(BrowserFavorites),
            "BrowserForward" => Ok(BrowserForward),
            "BrowserHome" => Ok(BrowserHome),
            "BrowserRefresh" => Ok(BrowserRefresh),
            "BrowserSearch" => Ok(BrowserSearch),
            "BrowserStop" => Ok(BrowserStop),
            "Eject" => Ok(Eject),
            "LaunchApp1" => Ok(LaunchApp1),
            "LaunchApp2" => Ok(LaunchApp2),
            "LaunchMail" => Ok(LaunchMail),
            "MediaPlayPause" => Ok(MediaPlayPause),
            "MediaSelect" | "LaunchMediaPlayer" => Ok(MediaSelect),
            "MediaStop" => Ok(MediaStop),
            "MediaTrackNext" => Ok(MediaTrackNext),
            "MediaTrackPrevious" => Ok(MediaTrackPrevious),
            "Power" => Ok(Power),
            "Sleep" => Ok(Sleep),
            "AudioVolumeDown" | "VolumeDown" => Ok(AudioVolumeDown),
            "AudioVolumeMute" | "VolumeMute" => Ok(AudioVolumeMute),
            "AudioVolumeUp" | "VolumeUp" => Ok(AudioVolumeUp),
            "WakeUp" => Ok(WakeUp),
            "Hyper" => Ok(Hyper),
            "Super" => Ok(Super),
            "Turbo" => Ok(Turbo),
            "Abort" => Ok(Abort),
            "Resume" => Ok(Resume),
            "Suspend" => Ok(Suspend),
            "Again" => Ok(Again),
            "Copy" => Ok(Copy),
            "Cut" => Ok(Cut),
            "Find" => Ok(Find),
            "Open" => Ok(Open),
            "Paste" => Ok(Paste),
            "Props" => Ok(Props),
            "Select" => Ok(Select),
            "Undo" => Ok(Undo),
            "Hiragana" => Ok(Hiragana),
            "Katakana" => Ok(Katakana),
            "Unidentified" => Ok(Unidentified),
            "F1" => Ok(F1),
            "F2" => Ok(F2),
            "F3" => Ok(F3),
            "F4" => Ok(F4),
            "F5" => Ok(F5),
            "F6" => Ok(F6),
            "F7" => Ok(F7),
            "F8" => Ok(F8),
            "F9" => Ok(F9),
            "F10" => Ok(F10),
            "F11" => Ok(F11),
            "F12" => Ok(F12),
            "F13" => Ok(F13),
            "F14" => Ok(F14),
            "F15" => Ok(F15),
            "F16" => Ok(F16),
            "F17" => Ok(F17),
            "F18" => Ok(F18),
            "F19" => Ok(F19),
            "F20" => Ok(F20),
            "F21" => Ok(F21),
            "F22" => Ok(F22),
            "F23" => Ok(F23),
            "F24" => Ok(F24),
            "F25" => Ok(F25),
            "F26" => Ok(F26),
            "F27" => Ok(F27),
            "F28" => Ok(F28),
            "F29" => Ok(F29),
            "F30" => Ok(F30),
            "F31" => Ok(F31),
            "F32" => Ok(F32),
            "F33" => Ok(F33),
            "F34" => Ok(F34),
            "F35" => Ok(F35),
            "BrightnessDown" => Ok(BrightnessDown),
            "BrightnessUp" => Ok(BrightnessUp),
            "DisplayToggleIntExt" => Ok(DisplayToggleIntExt),
            "KeyboardLayoutSelect" => Ok(KeyboardLayoutSelect),
            "LaunchAssistant" => Ok(LaunchAssistant),
            "LaunchControlPanel" => Ok(LaunchControlPanel),
            "LaunchScreenSaver" => Ok(LaunchScreenSaver),
            "MailForward" => Ok(MailForward),
            "MailReply" => Ok(MailReply),
            "MailSend" => Ok(MailSend),
            "MediaFastForward" => Ok(MediaFastForward),
            "MediaPause" => Ok(MediaPause),
            "MediaPlay" => Ok(MediaPlay),
            "MediaRecord" => Ok(MediaRecord),
            "MediaRewind" => Ok(MediaRewind),
            "MicrophoneMuteToggle" => Ok(MicrophoneMuteToggle),
            "PrivacyScreenToggle" => Ok(PrivacyScreenToggle),
            "SelectTask" => Ok(SelectTask),
            "ShowAllWindows" => Ok(ShowAllWindows),
            "ZoomToggle" => Ok(ZoomToggle),

            _ => Err(UnrecognizedCodeError),
        }
    }
}

/// Parse from string error, returned when string does not match to any Code variant.
#[derive(Clone, Debug)]
pub struct UnrecognizedCodeError;

impl fmt::Display for UnrecognizedCodeError {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "Unrecognized code")
    }
}

impl Error for UnrecognizedCodeError {}
    
