
// AUTO GENERATED CODE - DO NOT EDIT
#![cfg_attr(rustfmt, rustfmt_skip)]

use std::fmt::{self, Display};
use std::str::FromStr;
use std::error::Error;

/// Key represents the meaning of a keypress.
///
/// Specification:
/// <https://w3c.github.io/uievents-key/>
#[derive(Clone, Debug, Eq, PartialEq, Hash)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[non_exhaustive]
pub enum Key {
    /// A key string that corresponds to the character typed by the user,
    /// taking into account the user’s current locale setting, modifier state,
    /// and any system-level keyboard mapping overrides that are in effect.
    Character(String),
    
    /// This key value is used when an implementation is unable to
    /// identify another key value, due to either hardware,
    /// platform, or software constraints.
    Unidentified,
    /// The <code class="keycap">Alt</code> (Alternative) key.<br> This key enables the alternate modifier function for interpreting concurrent or subsequent keyboard input.<br> This key value is also used for the Apple <code class="keycap">Option</code> key.
    Alt,
    /// The Alternate Graphics (<code class="keycap">AltGr</code> or <code class="keycap">AltGraph</code>) key.
    /// This key is used enable the ISO Level 3 shift modifier (the standard <code class="keycap">Shift</code> key is the level 2 modifier).
    /// See [ISO9995-1].
    AltGraph,
    /// The <code class="keycap">Caps Lock</code> (Capital) key.
    /// Toggle capital character lock function for interpreting subsequent keyboard input event.
    CapsLock,
    /// The <code class="keycap">Control</code> or <code class="keycap">Ctrl</code> key, to enable control modifier function for interpreting concurrent or subsequent keyboard input.
    Control,
    /// The Function switch <code class="keycap">Fn</code> key.<br> Activating this key simultaneously with another key changes that key’s value to an alternate character or function.
    /// This key is often handled directly in the keyboard hardware and does not usually generate key events.
    Fn,
    /// The Function-Lock (<code class="keycap">FnLock</code> or <code class="keycap">F-Lock</code>) key.
    /// Activating this key switches the mode of the keyboard to changes some keys' values to an alternate character or function.
    /// This key is often handled directly in the keyboard hardware and does not usually generate key events.
    FnLock,
    /// The <code class="keycap">Meta</code> key, to enable meta modifier function for interpreting concurrent or subsequent keyboard input.
    /// This key value is used for the <q>Windows Logo</q> key and the Apple <code class="keycap">Command</code> or <code class="keycap">⌘</code> key.
    Meta,
    /// The <code class="keycap">NumLock</code> or Number Lock key, to toggle numpad mode function for interpreting subsequent keyboard input.
    NumLock,
    /// The <code class="keycap">Scroll Lock</code> key, to toggle between scrolling and cursor movement modes.
    ScrollLock,
    /// The <code class="keycap">Shift</code> key, to enable shift modifier function for interpreting concurrent or subsequent keyboard input.
    Shift,
    /// The Symbol modifier key (used on some virtual keyboards).
    Symbol,
    /// The Symbol Lock key.
    SymbolLock,
    /// The <code class="keycap">Hyper</code> key.
    Hyper,
    /// The <code class="keycap">Super</code> key.
    Super,
    /// The <code class="keycap">Enter</code> or <code class="keycap">↵</code> key, to activate current selection or accept current input.<br> This key value is also used for the <code class="keycap">Return</code> (Macintosh numpad) key.<br> This key value is also used for the Android <code class="android">KEYCODE_DPAD_CENTER</code>.
    Enter,
    /// The Horizontal Tabulation <code class="keycap">Tab</code> key.
    Tab,
    /// The down arrow key, to navigate or traverse downward. (<code class="android">KEYCODE_DPAD_DOWN</code>)
    ArrowDown,
    /// The left arrow key, to navigate or traverse leftward. (<code class="android">KEYCODE_DPAD_LEFT</code>)
    ArrowLeft,
    /// The right arrow key, to navigate or traverse rightward. (<code class="android">KEYCODE_DPAD_RIGHT</code>)
    ArrowRight,
    /// The up arrow key, to navigate or traverse upward. (<code class="android">KEYCODE_DPAD_UP</code>)
    ArrowUp,
    /// The End key, used with keyboard entry to go to the end of content (<code class="android">KEYCODE_MOVE_END</code>).
    End,
    /// The Home key, used with keyboard entry, to go to start of content (<code class="android">KEYCODE_MOVE_HOME</code>).<br> For the mobile phone <code class="keycap">Home</code> key (which goes to the phone’s main screen), use <code class="key">"GoHome"</code>.
    Home,
    /// The Page Down key, to scroll down or display next page of content.
    PageDown,
    /// The Page Up key, to scroll up or display previous page of content.
    PageUp,
    /// The Backspace key. This key value is also used for the key labeled <code class="keycap">Delete</code> on MacOS keyboards.
    Backspace,
    /// Remove the currently selected input.
    Clear,
    /// Copy the current selection. (<code class="appcommand">APPCOMMAND_COPY</code>)
    Copy,
    /// The Cursor Select (Crsel) key.
    CrSel,
    /// Cut the current selection. (<code class="appcommand">APPCOMMAND_CUT</code>)
    Cut,
    /// The Delete (Del) Key.
    /// This key value is also used for the key labeled <code class="keycap">Delete</code> on MacOS keyboards when modified by the <code class="keycap">Fn</code> key.
    Delete,
    /// The Erase to End of Field key.
    /// This key deletes all characters from the current cursor position to the end of the current field.
    EraseEof,
    /// The Extend Selection (Exsel) key.
    ExSel,
    /// The Insert (Ins) key, to toggle between text modes for insertion or overtyping. (<code class="android">KEYCODE_INSERT</code>)
    Insert,
    /// The Paste key. (<code class="appcommand">APPCOMMAND_PASTE</code>)
    Paste,
    /// Redo the last action. (<code class="appcommand">APPCOMMAND_REDO</code>)
    Redo,
    /// Undo the last action. (<code class="appcommand">APPCOMMAND_UNDO</code>)
    Undo,
    /// The Accept (Commit, OK) key. Accept current option or input method sequence conversion.
    Accept,
    /// The Again key, to redo or repeat an action.
    Again,
    /// The Attention (Attn) key.
    Attn,
    /// The Cancel key.
    Cancel,
    /// Show the application’s context menu.
    /// This key is commonly found between the right <code class="keycap">Meta</code> key and the right <code class="keycap">Control</code> key.
    ContextMenu,
    /// The <code class="keycap">Esc</code> key. This key was originally used to initiate an escape sequence, but is
    /// now more generally used to exit or "escape" the current context, such as closing a dialog
    /// or exiting full screen mode.
    Escape,
    /// The Execute key.
    Execute,
    /// Open the Find dialog. (<code class="appcommand">APPCOMMAND_FIND</code>)
    Find,
    /// Open a help dialog or toggle display of help information. (<code class="appcommand"><code class="appcommand">APPCOMMAND_HELP</code></code>, <code class="android"><code class="android">KEYCODE_HELP</code></code>)
    Help,
    /// Pause the current state or application (as appropriate).
    /// <p class="note" role="note">Do not use this value for the <code class="keycap">Pause</code> button on media controllers. Use <code class="key">"MediaPause"</code> instead.</p>
    Pause,
    /// Play or resume the current state or application (as appropriate).
    /// <p class="note" role="note">Do not use this value for the <code class="keycap">Play</code> button on media controllers. Use <code class="key">"MediaPlay"</code> instead.</p>
    Play,
    /// The properties (Props) key.
    Props,
    /// The Select key.
    Select,
    /// The ZoomIn key. (<code class="android">KEYCODE_ZOOM_IN</code>)
    ZoomIn,
    /// The ZoomOut key. (<code class="android">KEYCODE_ZOOM_OUT</code>)
    ZoomOut,
    /// The Brightness Down key. Typically controls the display brightness. (<code class="android">KEYCODE_BRIGHTNESS_DOWN</code>)
    BrightnessDown,
    /// The Brightness Up key. Typically controls the display brightness. (<code class="android">KEYCODE_BRIGHTNESS_UP</code>)
    BrightnessUp,
    /// Toggle removable media to eject (open) and insert (close) state. (<code class="android">KEYCODE_MEDIA_EJECT</code>)
    Eject,
    /// The LogOff key.
    LogOff,
    /// Toggle power state. (<code class="android">KEYCODE_POWER</code>)
    /// <p class="note" role="note">Note: Some devices might not expose this key to the operating environment.</p>
    Power,
    /// The <code class="keycap">PowerOff</code> key. Sometime called <code class="keycap">PowerDown</code>.
    PowerOff,
    /// The <code class="keycap">Print Screen</code> or <code class="keycap">SnapShot</code> key, to initiate print-screen function.
    PrintScreen,
    /// The Hibernate key.
    /// This key saves the current state of the computer to disk so that it can be restored. The computer will then shutdown.
    Hibernate,
    /// The Standby key.
    /// This key turns off the display and places the computer into a low-power mode without completely shutting down.
    /// It is sometimes labelled <code class="keycap">Suspend</code> or <code class="keycap">Sleep</code> key. (<code class="android"><code class="android">KEYCODE_SLEEP</code></code>)
    Standby,
    /// The WakeUp key. (<code class="android">KEYCODE_WAKEUP</code>)
    WakeUp,
    /// The All Candidates key, to initate the multi-candidate mode.
    AllCandidates,
    /// The Alphanumeric key.
    Alphanumeric,
    /// The Code Input key, to initiate the Code Input mode to allow characters to be entered by their code points.
    CodeInput,
    /// The Compose key, also known as <em>Multi_key</em> on the X Window System.
    /// This key acts in a manner similar to a
    /// dead key, triggering a mode where subsequent key presses are combined to produce a different character.
    Compose,
    /// The Convert key, to convert the current input method sequence.
    Convert,
    /// A dead key combining key. It may be any combining key from any keyboard layout. For example, on a
    /// PC/AT French keyboard, using a French mapping and without any modifier activiated, this is the key value <code class="unicode">U+0302</code> COMBINING CIRCUMFLEX ACCENT. In another layout this might be a different unicode combining key.<br> For applications that need to differentiate between specific combining characters, the associated compositionupdate event’s data attribute provides the specific key value.
    Dead,
    /// The Final Mode <code class="keycap">Final</code> key used on some Asian keyboards, to enable the final mode for IMEs.
    FinalMode,
    /// Switch to the first character group. (ISO/IEC 9995)
    GroupFirst,
    /// Switch to the last character group. (ISO/IEC 9995)
    GroupLast,
    /// Switch to the next character group. (ISO/IEC 9995)
    GroupNext,
    /// Switch to the previous character group. (ISO/IEC 9995)
    GroupPrevious,
    /// The Mode Change key, to toggle between or cycle through input modes of IMEs.
    ModeChange,
    /// The Next Candidate function key.
    NextCandidate,
    /// The NonConvert ("Don’t Convert") key, to accept current input method sequence without conversion in IMEs.
    NonConvert,
    /// The Previous Candidate function key.
    PreviousCandidate,
    /// The Process key.
    Process,
    /// The Single Candidate function key.
    SingleCandidate,
    /// The Hangul (Korean characters) Mode key, to toggle between Hangul and English modes.
    HangulMode,
    /// The Hanja (Korean characters) Mode key.
    HanjaMode,
    /// The Junja (Korean characters) Mode key.
    JunjaMode,
    /// The Eisu key. This key may close the IME, but its purpose
    /// is defined by the current IME. (<code class="android">KEYCODE_EISU</code>)
    Eisu,
    /// The (Half-Width) Characters key.
    Hankaku,
    /// The Hiragana (Japanese Kana characters) key.
    Hiragana,
    /// The Hiragana/Katakana toggle key. (<code class="android">KEYCODE_KATAKANA_HIRAGANA</code>)
    HiraganaKatakana,
    /// The Kana Mode (Kana Lock) key. This key is used to enter
    /// hiragana mode (typically from romaji mode).
    KanaMode,
    /// The Kanji (Japanese name for ideographic characters of Chinese origin) Mode key.
    /// This key is typically used to switch to a hiragana keyboard for
    /// the purpose of converting input into kanji. (<code class="android">KEYCODE_KANA</code>)
    KanjiMode,
    /// The Katakana (Japanese Kana characters) key.
    Katakana,
    /// The Roman characters function key.
    Romaji,
    /// The Zenkaku (Full-Width) Characters key.
    Zenkaku,
    /// The Zenkaku/Hankaku (full-width/half-width) toggle key. (<code class="android">KEYCODE_ZENKAKU_HANKAKU</code>)
    ZenkakuHankaku,
    /// General purpose virtual function key, as index 1.
    Soft1,
    /// General purpose virtual function key, as index 2.
    Soft2,
    /// General purpose virtual function key, as index 3.
    Soft3,
    /// General purpose virtual function key, as index 4.
    Soft4,
    /// Select next (numerically or logically) lower channel. (<code class="appcommand"><code class="appcommand">APPCOMMAND_MEDIA_CHANNEL_DOWN</code></code>, <code class="android"><code class="android">KEYCODE_CHANNEL_DOWN</code></code>)
    ChannelDown,
    /// Select next (numerically or logically) higher channel. (<code class="appcommand"><code class="appcommand">APPCOMMAND_MEDIA_CHANNEL_UP</code></code>, <code class="android"><code class="android">KEYCODE_CHANNEL_UP</code></code>)
    ChannelUp,
    /// Close the current document or message (Note: This doesn’t close the application). (<code class="appcommand">APPCOMMAND_CLOSE</code>)
    Close,
    /// Open an editor to forward the current message. (<code class="appcommand">APPCOMMAND_FORWARD_MAIL</code>)
    MailForward,
    /// Open an editor to reply to the current message. (<code class="appcommand">APPCOMMAND_REPLY_TO_MAIL</code>)
    MailReply,
    /// Send the current message. (<code class="appcommand">APPCOMMAND_SEND_MAIL</code>)
    MailSend,
    /// Close the current media, for example to close a CD or DVD tray. (<code class="android">KEYCODE_MEDIA_CLOSE</code>)
    MediaClose,
    /// Initiate or continue forward playback at faster than normal speed, or increase speed if already fast forwarding. (<code class="appcommand"><code class="appcommand">APPCOMMAND_MEDIA_FAST_FORWARD</code></code>, <code class="android"><code class="android">KEYCODE_MEDIA_FAST_FORWARD</code></code>)
    MediaFastForward,
    /// Pause the currently playing media. (<code class="appcommand"><code class="appcommand">APPCOMMAND_MEDIA_PAUSE</code></code>, <code class="android"><code class="android">KEYCODE_MEDIA_PAUSE</code></code>)
    /// <p class="note" role="note">Media controller devices should use this value rather than <code class="key">"Pause"</code> for their pause keys.</p>
    MediaPause,
    /// Initiate or continue media playback at normal speed, if not currently playing at normal speed. (<code class="appcommand"><code class="appcommand">APPCOMMAND_MEDIA_PLAY</code></code>, <code class="android"><code class="android">KEYCODE_MEDIA_PLAY</code></code>)
    MediaPlay,
    /// Toggle media between play and pause states. (<code class="appcommand"><code class="appcommand">APPCOMMAND_MEDIA_PLAY_PAUSE</code></code>, <code class="android"><code class="android">KEYCODE_MEDIA_PLAY_PAUSE</code></code>)
    MediaPlayPause,
    /// Initiate or resume recording of currently selected media. (<code class="appcommand"><code class="appcommand">APPCOMMAND_MEDIA_RECORD</code></code>, <code class="android"><code class="android">KEYCODE_MEDIA_RECORD</code></code>)
    MediaRecord,
    /// Initiate or continue reverse playback at faster than normal speed, or increase speed if already rewinding. (<code class="appcommand"><code class="appcommand">APPCOMMAND_MEDIA_REWIND</code></code>, <code class="android"><code class="android">KEYCODE_MEDIA_REWIND</code></code>)
    MediaRewind,
    /// Stop media playing, pausing, forwarding, rewinding, or recording, if not already stopped. (<code class="appcommand"><code class="appcommand">APPCOMMAND_MEDIA_STOP</code></code>, <code class="android"><code class="android">KEYCODE_MEDIA_STOP</code></code>)
    MediaStop,
    /// Seek to next media or program track. (<code class="appcommand"><code class="appcommand">APPCOMMAND_MEDIA_NEXTTRACK</code></code>, <code class="android"><code class="android">KEYCODE_MEDIA_NEXT</code></code>)
    MediaTrackNext,
    /// Seek to previous media or program track. (<code class="appcommand"><code class="appcommand">APPCOMMAND_MEDIA_PREVIOUSTRACK</code></code>, <code class="android"><code class="android">KEYCODE_MEDIA_PREVIOUS</code></code>)
    MediaTrackPrevious,
    /// Open a new document or message. (<code class="appcommand">APPCOMMAND_NEW</code>)
    New,
    /// Open an existing document or message. (<code class="appcommand">APPCOMMAND_OPEN</code>)
    Open,
    /// Print the current document or message. (<code class="appcommand">APPCOMMAND_PRINT</code>)
    Print,
    /// Save the current document or message. (<code class="appcommand">APPCOMMAND_SAVE</code>)
    Save,
    /// Spellcheck the current document or selection. (<code class="appcommand">APPCOMMAND_SPELL_CHECK</code>)
    SpellCheck,
    /// The <code class="keycap">11</code> key found on media numpads that
    /// have buttons from <code class="keycap">1</code> ... <code class="keycap">12</code>.
    Key11,
    /// The <code class="keycap">12</code> key found on media numpads that
    /// have buttons from <code class="keycap">1</code> ... <code class="keycap">12</code>.
    Key12,
    /// Adjust audio balance leftward. (<code class="vk">VK_AUDIO_BALANCE_LEFT</code>)
    AudioBalanceLeft,
    /// Adjust audio balance rightward. (<code class="vk">VK_AUDIO_BALANCE_RIGHT</code>)
    AudioBalanceRight,
    /// Decrease audio bass boost or cycle down through bass boost states. (<code class="appcommand"><code class="appcommand">APPCOMMAND_BASS_DOWN</code></code>, <code class="vk"><code class="vk">VK_BASS_BOOST_DOWN</code></code>)
    AudioBassBoostDown,
    /// Toggle bass boost on/off. (<code class="appcommand">APPCOMMAND_BASS_BOOST</code>)
    AudioBassBoostToggle,
    /// Increase audio bass boost or cycle up through bass boost states. (<code class="appcommand"><code class="appcommand">APPCOMMAND_BASS_UP</code></code>, <code class="vk"><code class="vk">VK_BASS_BOOST_UP</code></code>)
    AudioBassBoostUp,
    /// Adjust audio fader towards front. (<code class="vk">VK_FADER_FRONT</code>)
    AudioFaderFront,
    /// Adjust audio fader towards rear. (<code class="vk">VK_FADER_REAR</code>)
    AudioFaderRear,
    /// Advance surround audio mode to next available mode. (<code class="vk">VK_SURROUND_MODE_NEXT</code>)
    AudioSurroundModeNext,
    /// Decrease treble. (<code class="appcommand">APPCOMMAND_TREBLE_DOWN</code>)
    AudioTrebleDown,
    /// Increase treble. (<code class="appcommand">APPCOMMAND_TREBLE_UP</code>)
    AudioTrebleUp,
    /// Decrease audio volume. (<code class="appcommand"><code class="appcommand">APPCOMMAND_VOLUME_DOWN</code></code>, <code class="android"><code class="android">KEYCODE_VOLUME_DOWN</code></code>)
    AudioVolumeDown,
    /// Increase audio volume. (<code class="appcommand"><code class="appcommand">APPCOMMAND_VOLUME_UP</code></code>, <code class="android"><code class="android">KEYCODE_VOLUME_UP</code></code>)
    AudioVolumeUp,
    /// Toggle between muted state and prior volume level. (<code class="appcommand"><code class="appcommand">APPCOMMAND_VOLUME_MUTE</code></code>, <code class="android"><code class="android">KEYCODE_VOLUME_MUTE</code></code>)
    AudioVolumeMute,
    /// Toggle the microphone on/off. (<code class="appcommand">APPCOMMAND_MIC_ON_OFF_TOGGLE</code>)
    MicrophoneToggle,
    /// Decrease microphone volume. (<code class="appcommand">APPCOMMAND_MICROPHONE_VOLUME_DOWN</code>)
    MicrophoneVolumeDown,
    /// Increase microphone volume. (<code class="appcommand">APPCOMMAND_MICROPHONE_VOLUME_UP</code>)
    MicrophoneVolumeUp,
    /// Mute the microphone. (<code class="appcommand"><code class="appcommand">APPCOMMAND_MICROPHONE_VOLUME_MUTE</code></code>, <code class="android"><code class="android">KEYCODE_MUTE</code></code>)
    MicrophoneVolumeMute,
    /// Show correction list when a word is incorrectly identified. (<code class="appcommand">APPCOMMAND_CORRECTION_LIST</code>)
    SpeechCorrectionList,
    /// Toggle between dictation mode and command/control mode. (<code class="appcommand">APPCOMMAND_DICTATE_OR_COMMAND_CONTROL_TOGGLE</code>)
    SpeechInputToggle,
    /// The first generic "LaunchApplication" key. This is commonly associated with launching "My Computer", and may have a computer symbol on the key. (<code class="appcommand">APPCOMMAND_LAUNCH_APP1</code>)
    LaunchApplication1,
    /// The second generic "LaunchApplication" key. This is commonly associated with launching "Calculator", and may have a calculator symbol on the key. (<code class="appcommand"><code class="appcommand">APPCOMMAND_LAUNCH_APP2</code></code>, <code class="android"><code class="android">KEYCODE_CALCULATOR</code></code>)
    LaunchApplication2,
    /// The "Calendar" key. (<code class="android">KEYCODE_CALENDAR</code>)
    LaunchCalendar,
    /// The "Contacts" key. (<code class="android">KEYCODE_CONTACTS</code>)
    LaunchContacts,
    /// The "Mail" key. (<code class="appcommand">APPCOMMAND_LAUNCH_MAIL</code>)
    LaunchMail,
    /// The "Media Player" key. (<code class="appcommand">APPCOMMAND_LAUNCH_MEDIA_SELECT</code>)
    LaunchMediaPlayer,
    /// The "Music Player" key.
    LaunchMusicPlayer,
    /// The "Phone" key.
    LaunchPhone,
    /// The "Screen Saver" key.
    LaunchScreenSaver,
    /// The "Spreadsheet" key.
    LaunchSpreadsheet,
    /// The "Web Browser" key.
    LaunchWebBrowser,
    /// The "WebCam" key.
    LaunchWebCam,
    /// The "Word Processor" key.
    LaunchWordProcessor,
    /// Navigate to previous content or page in current history. (<code class="appcommand">APPCOMMAND_BROWSER_BACKWARD</code>)
    BrowserBack,
    /// Open the list of browser favorites. (<code class="appcommand">APPCOMMAND_BROWSER_FAVORITES</code>)
    BrowserFavorites,
    /// Navigate to next content or page in current history. (<code class="appcommand">APPCOMMAND_BROWSER_FORWARD</code>)
    BrowserForward,
    /// Go to the user’s preferred home page. (<code class="appcommand">APPCOMMAND_BROWSER_HOME</code>)
    BrowserHome,
    /// Refresh the current page or content. (<code class="appcommand">APPCOMMAND_BROWSER_REFRESH</code>)
    BrowserRefresh,
    /// Call up the user’s preferred search page. (<code class="appcommand">APPCOMMAND_BROWSER_SEARCH</code>)
    BrowserSearch,
    /// Stop loading the current page or content. (<code class="appcommand">APPCOMMAND_BROWSER_STOP</code>)
    BrowserStop,
    /// The Application switch key, which provides a list of recent apps to switch between. (<code class="android">KEYCODE_APP_SWITCH</code>)
    AppSwitch,
    /// The Call key. (<code class="android">KEYCODE_CALL</code>)
    Call,
    /// The Camera key. (<code class="android">KEYCODE_CAMERA</code>)
    Camera,
    /// The Camera focus key. (<code class="android">KEYCODE_FOCUS</code>)
    CameraFocus,
    /// The End Call key. (<code class="android">KEYCODE_ENDCALL</code>)
    EndCall,
    /// The Back key. (<code class="android">KEYCODE_BACK</code>)
    GoBack,
    /// The Home key, which goes to the phone’s main screen. (<code class="android">KEYCODE_HOME</code>)
    GoHome,
    /// The Headset Hook key. (<code class="android">KEYCODE_HEADSETHOOK</code>)
    HeadsetHook,
    /// The Last Number Redial key.
    LastNumberRedial,
    /// The Notification key. (<code class="android">KEYCODE_NOTIFICATION</code>)
    Notification,
    /// Toggle between manner mode state: silent, vibrate, ring, ... (<code class="android">KEYCODE_MANNER_MODE</code>)
    MannerMode,
    /// The Voice Dial key.
    VoiceDial,
    /// Switch to viewing TV. (<code class="android">KEYCODE_TV</code>)
    TV,
    /// TV 3D Mode. (<code class="android">KEYCODE_3D_MODE</code>)
    TV3DMode,
    /// Toggle between antenna and cable input. (<code class="android">KEYCODE_TV_ANTENNA_CABLE</code>)
    TVAntennaCable,
    /// Audio description. (<code class="android">KEYCODE_TV_AUDIO_DESCRIPTION</code>)
    TVAudioDescription,
    /// Audio description mixing volume down. (<code class="android">KEYCODE_TV_AUDIO_DESCRIPTION_MIX_DOWN</code>)
    TVAudioDescriptionMixDown,
    /// Audio description mixing volume up. (<code class="android">KEYCODE_TV_AUDIO_DESCRIPTION_MIX_UP</code>)
    TVAudioDescriptionMixUp,
    /// Contents menu. (<code class="android">KEYCODE_TV_CONTENTS_MENU</code>)
    TVContentsMenu,
    /// Contents menu. (<code class="android">KEYCODE_TV_DATA_SERVICE</code>)
    TVDataService,
    /// Switch the input mode on an external TV. (<code class="android">KEYCODE_TV_INPUT</code>)
    TVInput,
    /// Switch to component input #1. (<code class="android">KEYCODE_TV_INPUT_COMPONENT_1</code>)
    TVInputComponent1,
    /// Switch to component input #2. (<code class="android">KEYCODE_TV_INPUT_COMPONENT_2</code>)
    TVInputComponent2,
    /// Switch to composite input #1. (<code class="android">KEYCODE_TV_INPUT_COMPOSITE_1</code>)
    TVInputComposite1,
    /// Switch to composite input #2. (<code class="android">KEYCODE_TV_INPUT_COMPOSITE_2</code>)
    TVInputComposite2,
    /// Switch to HDMI input #1. (<code class="android">KEYCODE_TV_INPUT_HDMI_1</code>)
    TVInputHDMI1,
    /// Switch to HDMI input #2. (<code class="android">KEYCODE_TV_INPUT_HDMI_2</code>)
    TVInputHDMI2,
    /// Switch to HDMI input #3. (<code class="android">KEYCODE_TV_INPUT_HDMI_3</code>)
    TVInputHDMI3,
    /// Switch to HDMI input #4. (<code class="android">KEYCODE_TV_INPUT_HDMI_4</code>)
    TVInputHDMI4,
    /// Switch to VGA input #1. (<code class="android">KEYCODE_TV_INPUT_VGA_1</code>)
    TVInputVGA1,
    /// Media context menu. (<code class="android">KEYCODE_TV_MEDIA_CONTEXT_MENU</code>)
    TVMediaContext,
    /// Toggle network. (<code class="android">KEYCODE_TV_NETWORK</code>)
    TVNetwork,
    /// Number entry. (<code class="android">KEYCODE_TV_NUMBER_ENTRY</code>)
    TVNumberEntry,
    /// Toggle the power on an external TV. (<code class="android">KEYCODE_TV_POWER</code>)
    TVPower,
    /// Radio. (<code class="android">KEYCODE_TV_RADIO_SERVICE</code>)
    TVRadioService,
    /// Satellite. (<code class="android">KEYCODE_TV_SATELLITE</code>)
    TVSatellite,
    /// Broadcast Satellite. (<code class="android">KEYCODE_TV_SATELLITE_BS</code>)
    TVSatelliteBS,
    /// Communication Satellite. (<code class="android">KEYCODE_TV_SATELLITE_CS</code>)
    TVSatelliteCS,
    /// Toggle between available satellites. (<code class="android">KEYCODE_TV_SATELLITE_SERVICE</code>)
    TVSatelliteToggle,
    /// Analog Terrestrial. (<code class="android">KEYCODE_TV_TERRESTRIAL_ANALOG</code>)
    TVTerrestrialAnalog,
    /// Digital Terrestrial. (<code class="android">KEYCODE_TV_TERRESTRIAL_DIGITAL</code>)
    TVTerrestrialDigital,
    /// Timer programming. (<code class="android">KEYCODE_TV_TIMER_PROGRAMMING</code>)
    TVTimer,
    /// Switch the input mode on an external AVR (audio/video receiver). (<code class="android">KEYCODE_AVR_INPUT</code>)
    AVRInput,
    /// Toggle the power on an external AVR (audio/video receiver). (<code class="android">KEYCODE_AVR_POWER</code>)
    AVRPower,
    /// General purpose color-coded media function key, as index 0 (red). (<code class="vk"><code class="vk">VK_COLORED_KEY_0</code></code>, <code class="android"><code class="android">KEYCODE_PROG_RED</code></code>)
    ColorF0Red,
    /// General purpose color-coded media function key, as index 1 (green). (<code class="vk"><code class="vk">VK_COLORED_KEY_1</code></code>, <code class="android"><code class="android">KEYCODE_PROG_GREEN</code></code>)
    ColorF1Green,
    /// General purpose color-coded media function key, as index 2 (yellow). (<code class="vk"><code class="vk">VK_COLORED_KEY_2</code></code>, <code class="android"><code class="android">KEYCODE_PROG_YELLOW</code></code>)
    ColorF2Yellow,
    /// General purpose color-coded media function key, as index 3 (blue). (<code class="vk"><code class="vk">VK_COLORED_KEY_3</code></code>, <code class="android"><code class="android">KEYCODE_PROG_BLUE</code></code>)
    ColorF3Blue,
    /// General purpose color-coded media function key, as index 4 (grey). (<code class="vk">VK_COLORED_KEY_4</code>)
    ColorF4Grey,
    /// General purpose color-coded media function key, as index 5 (brown). (<code class="vk">VK_COLORED_KEY_5</code>)
    ColorF5Brown,
    /// Toggle the display of Closed Captions. (<code class="vk"><code class="vk">VK_CC</code></code>, <code class="android"><code class="android">KEYCODE_CAPTIONS</code></code>)
    ClosedCaptionToggle,
    /// Adjust brightness of device, by toggling between or cycling through states. (<code class="vk">VK_DIMMER</code>)
    Dimmer,
    /// Swap video sources. (<code class="vk">VK_DISPLAY_SWAP</code>)
    DisplaySwap,
    /// Select Digital Video Rrecorder. (<code class="android">KEYCODE_DVR</code>)
    DVR,
    /// Exit the current application. (<code class="vk">VK_EXIT</code>)
    Exit,
    /// Clear program or content stored as favorite 0. (<code class="vk">VK_CLEAR_FAVORITE_0</code>)
    FavoriteClear0,
    /// Clear program or content stored as favorite 1. (<code class="vk">VK_CLEAR_FAVORITE_1</code>)
    FavoriteClear1,
    /// Clear program or content stored as favorite 2. (<code class="vk">VK_CLEAR_FAVORITE_2</code>)
    FavoriteClear2,
    /// Clear program or content stored as favorite 3. (<code class="vk">VK_CLEAR_FAVORITE_3</code>)
    FavoriteClear3,
    /// Select (recall) program or content stored as favorite 0. (<code class="vk">VK_RECALL_FAVORITE_0</code>)
    FavoriteRecall0,
    /// Select (recall) program or content stored as favorite 1. (<code class="vk">VK_RECALL_FAVORITE_1</code>)
    FavoriteRecall1,
    /// Select (recall) program or content stored as favorite 2. (<code class="vk">VK_RECALL_FAVORITE_2</code>)
    FavoriteRecall2,
    /// Select (recall) program or content stored as favorite 3. (<code class="vk">VK_RECALL_FAVORITE_3</code>)
    FavoriteRecall3,
    /// Store current program or content as favorite 0. (<code class="vk">VK_STORE_FAVORITE_0</code>)
    FavoriteStore0,
    /// Store current program or content as favorite 1. (<code class="vk">VK_STORE_FAVORITE_1</code>)
    FavoriteStore1,
    /// Store current program or content as favorite 2. (<code class="vk">VK_STORE_FAVORITE_2</code>)
    FavoriteStore2,
    /// Store current program or content as favorite 3. (<code class="vk">VK_STORE_FAVORITE_3</code>)
    FavoriteStore3,
    /// Toggle display of program or content guide. (<code class="vk"><code class="vk">VK_GUIDE</code></code>, <code class="android"><code class="android">KEYCODE_GUIDE</code></code>)
    Guide,
    /// If guide is active and displayed, then display next day’s content. (<code class="vk">VK_NEXT_DAY</code>)
    GuideNextDay,
    /// If guide is active and displayed, then display previous day’s content. (<code class="vk">VK_PREV_DAY</code>)
    GuidePreviousDay,
    /// Toggle display of information about currently selected context or media. (<code class="vk"><code class="vk">VK_INFO</code></code>, <code class="android"><code class="android">KEYCODE_INFO</code></code>)
    Info,
    /// Toggle instant replay. (<code class="vk">VK_INSTANT_REPLAY</code>)
    InstantReplay,
    /// Launch linked content, if available and appropriate. (<code class="vk">VK_LINK</code>)
    Link,
    /// List the current program. (<code class="vk">VK_LIST</code>)
    ListProgram,
    /// Toggle display listing of currently available live content or programs. (<code class="vk">VK_LIVE</code>)
    LiveContent,
    /// Lock or unlock current content or program. (<code class="vk">VK_LOCK</code>)
    Lock,
    /// Show a list of media applications: audio/video players and image viewers. (<code class="vk">VK_APPS</code>)
    /// <p class="note" role="note">Do not confuse this key value with the Windows' <code class="vk"><code class="vk">VK_APPS</code></code> / <code class="vk"><code class="vk">VK_CONTEXT_MENU</code></code> key, which is encoded as <code class="key">"ContextMenu"</code>.</p>
    MediaApps,
    /// Audio track key. (<code class="android">KEYCODE_MEDIA_AUDIO_TRACK</code>)
    MediaAudioTrack,
    /// Select previously selected channel or media. (<code class="vk"><code class="vk">VK_LAST</code></code>, <code class="android"><code class="android">KEYCODE_LAST_CHANNEL</code></code>)
    MediaLast,
    /// Skip backward to next content or program. (<code class="android">KEYCODE_MEDIA_SKIP_BACKWARD</code>)
    MediaSkipBackward,
    /// Skip forward to next content or program. (<code class="vk"><code class="vk">VK_SKIP</code></code>, <code class="android"><code class="android">KEYCODE_MEDIA_SKIP_FORWARD</code></code>)
    MediaSkipForward,
    /// Step backward to next content or program. (<code class="android">KEYCODE_MEDIA_STEP_BACKWARD</code>)
    MediaStepBackward,
    /// Step forward to next content or program. (<code class="android">KEYCODE_MEDIA_STEP_FORWARD</code>)
    MediaStepForward,
    /// Media top menu. (<code class="android">KEYCODE_MEDIA_TOP_MENU</code>)
    MediaTopMenu,
    /// Navigate in. (<code class="android">KEYCODE_NAVIGATE_IN</code>)
    NavigateIn,
    /// Navigate to next key. (<code class="android">KEYCODE_NAVIGATE_NEXT</code>)
    NavigateNext,
    /// Navigate out. (<code class="android">KEYCODE_NAVIGATE_OUT</code>)
    NavigateOut,
    /// Navigate to previous key. (<code class="android">KEYCODE_NAVIGATE_PREVIOUS</code>)
    NavigatePrevious,
    /// Cycle to next favorite channel (in favorites list). (<code class="vk">VK_NEXT_FAVORITE_CHANNEL</code>)
    NextFavoriteChannel,
    /// Cycle to next user profile (if there are multiple user profiles). (<code class="vk">VK_USER</code>)
    NextUserProfile,
    /// Access on-demand content or programs. (<code class="vk">VK_ON_DEMAND</code>)
    OnDemand,
    /// Pairing key to pair devices. (<code class="android">KEYCODE_PAIRING</code>)
    Pairing,
    /// Move picture-in-picture window down. (<code class="vk">VK_PINP_DOWN</code>)
    PinPDown,
    /// Move picture-in-picture window. (<code class="vk">VK_PINP_MOVE</code>)
    PinPMove,
    /// Toggle display of picture-in-picture window. (<code class="vk">VK_PINP_TOGGLE</code>)
    PinPToggle,
    /// Move picture-in-picture window up. (<code class="vk">VK_PINP_UP</code>)
    PinPUp,
    /// Decrease media playback speed. (<code class="vk">VK_PLAY_SPEED_DOWN</code>)
    PlaySpeedDown,
    /// Reset playback to normal speed. (<code class="vk">VK_PLAY_SPEED_RESET</code>)
    PlaySpeedReset,
    /// Increase media playback speed. (<code class="vk">VK_PLAY_SPEED_UP</code>)
    PlaySpeedUp,
    /// Toggle random media or content shuffle mode. (<code class="vk">VK_RANDOM_TOGGLE</code>)
    RandomToggle,
    /// Not a physical key, but this key code is sent when the remote control battery is low. (<code class="vk">VK_RC_LOW_BATTERY</code>)
    RcLowBattery,
    /// Toggle or cycle between media recording speeds. (<code class="vk">VK_RECORD_SPEED_NEXT</code>)
    RecordSpeedNext,
    /// Toggle RF (radio frequency) input bypass mode (pass RF input directly to the RF output). (<code class="vk">VK_RF_BYPASS</code>)
    RfBypass,
    /// Toggle scan channels mode. (<code class="vk">VK_SCAN_CHANNELS_TOGGLE</code>)
    ScanChannelsToggle,
    /// Advance display screen mode to next available mode. (<code class="vk">VK_SCREEN_MODE_NEXT</code>)
    ScreenModeNext,
    /// Toggle display of device settings screen. (<code class="vk"><code class="vk">VK_SETTINGS</code></code>, <code class="android"><code class="android">KEYCODE_SETTINGS</code></code>)
    Settings,
    /// Toggle split screen mode. (<code class="vk">VK_SPLIT_SCREEN_TOGGLE</code>)
    SplitScreenToggle,
    /// Switch the input mode on an external STB (set top box). (<code class="android">KEYCODE_STB_INPUT</code>)
    STBInput,
    /// Toggle the power on an external STB (set top box). (<code class="android">KEYCODE_STB_POWER</code>)
    STBPower,
    /// Toggle display of subtitles, if available. (<code class="vk">VK_SUBTITLE</code>)
    Subtitle,
    /// Toggle display of teletext, if available (<code class="vk"><code class="vk">VK_TELETEXT</code></code>, <code class="android"><code class="android">KEYCODE_TV_TELETEXT</code></code>).
    Teletext,
    /// Advance video mode to next available mode. (<code class="vk">VK_VIDEO_MODE_NEXT</code>)
    VideoModeNext,
    /// Cause device to identify itself in some manner, e.g., audibly or visibly. (<code class="vk">VK_WINK</code>)
    Wink,
    /// Toggle between full-screen and scaled content, or alter magnification level. (<code class="vk"><code class="vk">VK_ZOOM</code></code>, <code class="android"><code class="android">KEYCODE_TV_ZOOM_MODE</code></code>)
    ZoomToggle,
    /// The F1 key, a general purpose function key, as index 1.
    F1,
    /// The F2 key, a general purpose function key, as index 2.
    F2,
    /// The F3 key, a general purpose function key, as index 3.
    F3,
    /// The F4 key, a general purpose function key, as index 4.
    F4,
    /// The F5 key, a general purpose function key, as index 5.
    F5,
    /// The F6 key, a general purpose function key, as index 6.
    F6,
    /// The F7 key, a general purpose function key, as index 7.
    F7,
    /// The F8 key, a general purpose function key, as index 8.
    F8,
    /// The F9 key, a general purpose function key, as index 9.
    F9,
    /// The F10 key, a general purpose function key, as index 10.
    F10,
    /// The F11 key, a general purpose function key, as index 11.
    F11,
    /// The F12 key, a general purpose function key, as index 12.
    F12,
    /// The F13 key, a general purpose function key, as index 13.
    F13,
    /// The F14 key, a general purpose function key, as index 14.
    F14,
    /// The F15 key, a general purpose function key, as index 15.
    F15,
    /// The F16 key, a general purpose function key, as index 16.
    F16,
    /// The F17 key, a general purpose function key, as index 17.
    F17,
    /// The F18 key, a general purpose function key, as index 18.
    F18,
    /// The F19 key, a general purpose function key, as index 19.
    F19,
    /// The F20 key, a general purpose function key, as index 20.
    F20,
    /// The F21 key, a general purpose function key, as index 21.
    F21,
    /// The F22 key, a general purpose function key, as index 22.
    F22,
    /// The F23 key, a general purpose function key, as index 23.
    F23,
    /// The F24 key, a general purpose function key, as index 24.
    F24,
    /// The F25 key, a general purpose function key, as index 25.
    F25,
    /// The F26 key, a general purpose function key, as index 26.
    F26,
    /// The F27 key, a general purpose function key, as index 27.
    F27,
    /// The F28 key, a general purpose function key, as index 28.
    F28,
    /// The F29 key, a general purpose function key, as index 29.
    F29,
    /// The F30 key, a general purpose function key, as index 30.
    F30,
    /// The F31 key, a general purpose function key, as index 31.
    F31,
    /// The F32 key, a general purpose function key, as index 32.
    F32,
    /// The F33 key, a general purpose function key, as index 33.
    F33,
    /// The F34 key, a general purpose function key, as index 34.
    F34,
    /// The F35 key, a general purpose function key, as index 35.
    F35,
}


impl Display for Key {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        use self::Key::*;
        match *self {
            Character(ref s) => write!(f, "{}", s),
    
            Unidentified => f.write_str("Unidentified"),
            Alt => f.write_str("Alt"),
            AltGraph => f.write_str("AltGraph"),
            CapsLock => f.write_str("CapsLock"),
            Control => f.write_str("Control"),
            Fn => f.write_str("Fn"),
            FnLock => f.write_str("FnLock"),
            Meta => f.write_str("Meta"),
            NumLock => f.write_str("NumLock"),
            ScrollLock => f.write_str("ScrollLock"),
            Shift => f.write_str("Shift"),
            Symbol => f.write_str("Symbol"),
            SymbolLock => f.write_str("SymbolLock"),
            Hyper => f.write_str("Hyper"),
            Super => f.write_str("Super"),
            Enter => f.write_str("Enter"),
            Tab => f.write_str("Tab"),
            ArrowDown => f.write_str("ArrowDown"),
            ArrowLeft => f.write_str("ArrowLeft"),
            ArrowRight => f.write_str("ArrowRight"),
            ArrowUp => f.write_str("ArrowUp"),
            End => f.write_str("End"),
            Home => f.write_str("Home"),
            PageDown => f.write_str("PageDown"),
            PageUp => f.write_str("PageUp"),
            Backspace => f.write_str("Backspace"),
            Clear => f.write_str("Clear"),
            Copy => f.write_str("Copy"),
            CrSel => f.write_str("CrSel"),
            Cut => f.write_str("Cut"),
            Delete => f.write_str("Delete"),
            EraseEof => f.write_str("EraseEof"),
            ExSel => f.write_str("ExSel"),
            Insert => f.write_str("Insert"),
            Paste => f.write_str("Paste"),
            Redo => f.write_str("Redo"),
            Undo => f.write_str("Undo"),
            Accept => f.write_str("Accept"),
            Again => f.write_str("Again"),
            Attn => f.write_str("Attn"),
            Cancel => f.write_str("Cancel"),
            ContextMenu => f.write_str("ContextMenu"),
            Escape => f.write_str("Escape"),
            Execute => f.write_str("Execute"),
            Find => f.write_str("Find"),
            Help => f.write_str("Help"),
            Pause => f.write_str("Pause"),
            Play => f.write_str("Play"),
            Props => f.write_str("Props"),
            Select => f.write_str("Select"),
            ZoomIn => f.write_str("ZoomIn"),
            ZoomOut => f.write_str("ZoomOut"),
            BrightnessDown => f.write_str("BrightnessDown"),
            BrightnessUp => f.write_str("BrightnessUp"),
            Eject => f.write_str("Eject"),
            LogOff => f.write_str("LogOff"),
            Power => f.write_str("Power"),
            PowerOff => f.write_str("PowerOff"),
            PrintScreen => f.write_str("PrintScreen"),
            Hibernate => f.write_str("Hibernate"),
            Standby => f.write_str("Standby"),
            WakeUp => f.write_str("WakeUp"),
            AllCandidates => f.write_str("AllCandidates"),
            Alphanumeric => f.write_str("Alphanumeric"),
            CodeInput => f.write_str("CodeInput"),
            Compose => f.write_str("Compose"),
            Convert => f.write_str("Convert"),
            Dead => f.write_str("Dead"),
            FinalMode => f.write_str("FinalMode"),
            GroupFirst => f.write_str("GroupFirst"),
            GroupLast => f.write_str("GroupLast"),
            GroupNext => f.write_str("GroupNext"),
            GroupPrevious => f.write_str("GroupPrevious"),
            ModeChange => f.write_str("ModeChange"),
            NextCandidate => f.write_str("NextCandidate"),
            NonConvert => f.write_str("NonConvert"),
            PreviousCandidate => f.write_str("PreviousCandidate"),
            Process => f.write_str("Process"),
            SingleCandidate => f.write_str("SingleCandidate"),
            HangulMode => f.write_str("HangulMode"),
            HanjaMode => f.write_str("HanjaMode"),
            JunjaMode => f.write_str("JunjaMode"),
            Eisu => f.write_str("Eisu"),
            Hankaku => f.write_str("Hankaku"),
            Hiragana => f.write_str("Hiragana"),
            HiraganaKatakana => f.write_str("HiraganaKatakana"),
            KanaMode => f.write_str("KanaMode"),
            KanjiMode => f.write_str("KanjiMode"),
            Katakana => f.write_str("Katakana"),
            Romaji => f.write_str("Romaji"),
            Zenkaku => f.write_str("Zenkaku"),
            ZenkakuHankaku => f.write_str("ZenkakuHankaku"),
            Soft1 => f.write_str("Soft1"),
            Soft2 => f.write_str("Soft2"),
            Soft3 => f.write_str("Soft3"),
            Soft4 => f.write_str("Soft4"),
            ChannelDown => f.write_str("ChannelDown"),
            ChannelUp => f.write_str("ChannelUp"),
            Close => f.write_str("Close"),
            MailForward => f.write_str("MailForward"),
            MailReply => f.write_str("MailReply"),
            MailSend => f.write_str("MailSend"),
            MediaClose => f.write_str("MediaClose"),
            MediaFastForward => f.write_str("MediaFastForward"),
            MediaPause => f.write_str("MediaPause"),
            MediaPlay => f.write_str("MediaPlay"),
            MediaPlayPause => f.write_str("MediaPlayPause"),
            MediaRecord => f.write_str("MediaRecord"),
            MediaRewind => f.write_str("MediaRewind"),
            MediaStop => f.write_str("MediaStop"),
            MediaTrackNext => f.write_str("MediaTrackNext"),
            MediaTrackPrevious => f.write_str("MediaTrackPrevious"),
            New => f.write_str("New"),
            Open => f.write_str("Open"),
            Print => f.write_str("Print"),
            Save => f.write_str("Save"),
            SpellCheck => f.write_str("SpellCheck"),
            Key11 => f.write_str("Key11"),
            Key12 => f.write_str("Key12"),
            AudioBalanceLeft => f.write_str("AudioBalanceLeft"),
            AudioBalanceRight => f.write_str("AudioBalanceRight"),
            AudioBassBoostDown => f.write_str("AudioBassBoostDown"),
            AudioBassBoostToggle => f.write_str("AudioBassBoostToggle"),
            AudioBassBoostUp => f.write_str("AudioBassBoostUp"),
            AudioFaderFront => f.write_str("AudioFaderFront"),
            AudioFaderRear => f.write_str("AudioFaderRear"),
            AudioSurroundModeNext => f.write_str("AudioSurroundModeNext"),
            AudioTrebleDown => f.write_str("AudioTrebleDown"),
            AudioTrebleUp => f.write_str("AudioTrebleUp"),
            AudioVolumeDown => f.write_str("AudioVolumeDown"),
            AudioVolumeUp => f.write_str("AudioVolumeUp"),
            AudioVolumeMute => f.write_str("AudioVolumeMute"),
            MicrophoneToggle => f.write_str("MicrophoneToggle"),
            MicrophoneVolumeDown => f.write_str("MicrophoneVolumeDown"),
            MicrophoneVolumeUp => f.write_str("MicrophoneVolumeUp"),
            MicrophoneVolumeMute => f.write_str("MicrophoneVolumeMute"),
            SpeechCorrectionList => f.write_str("SpeechCorrectionList"),
            SpeechInputToggle => f.write_str("SpeechInputToggle"),
            LaunchApplication1 => f.write_str("LaunchApplication1"),
            LaunchApplication2 => f.write_str("LaunchApplication2"),
            LaunchCalendar => f.write_str("LaunchCalendar"),
            LaunchContacts => f.write_str("LaunchContacts"),
            LaunchMail => f.write_str("LaunchMail"),
            LaunchMediaPlayer => f.write_str("LaunchMediaPlayer"),
            LaunchMusicPlayer => f.write_str("LaunchMusicPlayer"),
            LaunchPhone => f.write_str("LaunchPhone"),
            LaunchScreenSaver => f.write_str("LaunchScreenSaver"),
            LaunchSpreadsheet => f.write_str("LaunchSpreadsheet"),
            LaunchWebBrowser => f.write_str("LaunchWebBrowser"),
            LaunchWebCam => f.write_str("LaunchWebCam"),
            LaunchWordProcessor => f.write_str("LaunchWordProcessor"),
            BrowserBack => f.write_str("BrowserBack"),
            BrowserFavorites => f.write_str("BrowserFavorites"),
            BrowserForward => f.write_str("BrowserForward"),
            BrowserHome => f.write_str("BrowserHome"),
            BrowserRefresh => f.write_str("BrowserRefresh"),
            BrowserSearch => f.write_str("BrowserSearch"),
            BrowserStop => f.write_str("BrowserStop"),
            AppSwitch => f.write_str("AppSwitch"),
            Call => f.write_str("Call"),
            Camera => f.write_str("Camera"),
            CameraFocus => f.write_str("CameraFocus"),
            EndCall => f.write_str("EndCall"),
            GoBack => f.write_str("GoBack"),
            GoHome => f.write_str("GoHome"),
            HeadsetHook => f.write_str("HeadsetHook"),
            LastNumberRedial => f.write_str("LastNumberRedial"),
            Notification => f.write_str("Notification"),
            MannerMode => f.write_str("MannerMode"),
            VoiceDial => f.write_str("VoiceDial"),
            TV => f.write_str("TV"),
            TV3DMode => f.write_str("TV3DMode"),
            TVAntennaCable => f.write_str("TVAntennaCable"),
            TVAudioDescription => f.write_str("TVAudioDescription"),
            TVAudioDescriptionMixDown => f.write_str("TVAudioDescriptionMixDown"),
            TVAudioDescriptionMixUp => f.write_str("TVAudioDescriptionMixUp"),
            TVContentsMenu => f.write_str("TVContentsMenu"),
            TVDataService => f.write_str("TVDataService"),
            TVInput => f.write_str("TVInput"),
            TVInputComponent1 => f.write_str("TVInputComponent1"),
            TVInputComponent2 => f.write_str("TVInputComponent2"),
            TVInputComposite1 => f.write_str("TVInputComposite1"),
            TVInputComposite2 => f.write_str("TVInputComposite2"),
            TVInputHDMI1 => f.write_str("TVInputHDMI1"),
            TVInputHDMI2 => f.write_str("TVInputHDMI2"),
            TVInputHDMI3 => f.write_str("TVInputHDMI3"),
            TVInputHDMI4 => f.write_str("TVInputHDMI4"),
            TVInputVGA1 => f.write_str("TVInputVGA1"),
            TVMediaContext => f.write_str("TVMediaContext"),
            TVNetwork => f.write_str("TVNetwork"),
            TVNumberEntry => f.write_str("TVNumberEntry"),
            TVPower => f.write_str("TVPower"),
            TVRadioService => f.write_str("TVRadioService"),
            TVSatellite => f.write_str("TVSatellite"),
            TVSatelliteBS => f.write_str("TVSatelliteBS"),
            TVSatelliteCS => f.write_str("TVSatelliteCS"),
            TVSatelliteToggle => f.write_str("TVSatelliteToggle"),
            TVTerrestrialAnalog => f.write_str("TVTerrestrialAnalog"),
            TVTerrestrialDigital => f.write_str("TVTerrestrialDigital"),
            TVTimer => f.write_str("TVTimer"),
            AVRInput => f.write_str("AVRInput"),
            AVRPower => f.write_str("AVRPower"),
            ColorF0Red => f.write_str("ColorF0Red"),
            ColorF1Green => f.write_str("ColorF1Green"),
            ColorF2Yellow => f.write_str("ColorF2Yellow"),
            ColorF3Blue => f.write_str("ColorF3Blue"),
            ColorF4Grey => f.write_str("ColorF4Grey"),
            ColorF5Brown => f.write_str("ColorF5Brown"),
            ClosedCaptionToggle => f.write_str("ClosedCaptionToggle"),
            Dimmer => f.write_str("Dimmer"),
            DisplaySwap => f.write_str("DisplaySwap"),
            DVR => f.write_str("DVR"),
            Exit => f.write_str("Exit"),
            FavoriteClear0 => f.write_str("FavoriteClear0"),
            FavoriteClear1 => f.write_str("FavoriteClear1"),
            FavoriteClear2 => f.write_str("FavoriteClear2"),
            FavoriteClear3 => f.write_str("FavoriteClear3"),
            FavoriteRecall0 => f.write_str("FavoriteRecall0"),
            FavoriteRecall1 => f.write_str("FavoriteRecall1"),
            FavoriteRecall2 => f.write_str("FavoriteRecall2"),
            FavoriteRecall3 => f.write_str("FavoriteRecall3"),
            FavoriteStore0 => f.write_str("FavoriteStore0"),
            FavoriteStore1 => f.write_str("FavoriteStore1"),
            FavoriteStore2 => f.write_str("FavoriteStore2"),
            FavoriteStore3 => f.write_str("FavoriteStore3"),
            Guide => f.write_str("Guide"),
            GuideNextDay => f.write_str("GuideNextDay"),
            GuidePreviousDay => f.write_str("GuidePreviousDay"),
            Info => f.write_str("Info"),
            InstantReplay => f.write_str("InstantReplay"),
            Link => f.write_str("Link"),
            ListProgram => f.write_str("ListProgram"),
            LiveContent => f.write_str("LiveContent"),
            Lock => f.write_str("Lock"),
            MediaApps => f.write_str("MediaApps"),
            MediaAudioTrack => f.write_str("MediaAudioTrack"),
            MediaLast => f.write_str("MediaLast"),
            MediaSkipBackward => f.write_str("MediaSkipBackward"),
            MediaSkipForward => f.write_str("MediaSkipForward"),
            MediaStepBackward => f.write_str("MediaStepBackward"),
            MediaStepForward => f.write_str("MediaStepForward"),
            MediaTopMenu => f.write_str("MediaTopMenu"),
            NavigateIn => f.write_str("NavigateIn"),
            NavigateNext => f.write_str("NavigateNext"),
            NavigateOut => f.write_str("NavigateOut"),
            NavigatePrevious => f.write_str("NavigatePrevious"),
            NextFavoriteChannel => f.write_str("NextFavoriteChannel"),
            NextUserProfile => f.write_str("NextUserProfile"),
            OnDemand => f.write_str("OnDemand"),
            Pairing => f.write_str("Pairing"),
            PinPDown => f.write_str("PinPDown"),
            PinPMove => f.write_str("PinPMove"),
            PinPToggle => f.write_str("PinPToggle"),
            PinPUp => f.write_str("PinPUp"),
            PlaySpeedDown => f.write_str("PlaySpeedDown"),
            PlaySpeedReset => f.write_str("PlaySpeedReset"),
            PlaySpeedUp => f.write_str("PlaySpeedUp"),
            RandomToggle => f.write_str("RandomToggle"),
            RcLowBattery => f.write_str("RcLowBattery"),
            RecordSpeedNext => f.write_str("RecordSpeedNext"),
            RfBypass => f.write_str("RfBypass"),
            ScanChannelsToggle => f.write_str("ScanChannelsToggle"),
            ScreenModeNext => f.write_str("ScreenModeNext"),
            Settings => f.write_str("Settings"),
            SplitScreenToggle => f.write_str("SplitScreenToggle"),
            STBInput => f.write_str("STBInput"),
            STBPower => f.write_str("STBPower"),
            Subtitle => f.write_str("Subtitle"),
            Teletext => f.write_str("Teletext"),
            VideoModeNext => f.write_str("VideoModeNext"),
            Wink => f.write_str("Wink"),
            ZoomToggle => f.write_str("ZoomToggle"),
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

        }
    }
}

impl FromStr for Key {
    type Err = UnrecognizedKeyError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        use crate::Key::*;
        match s {
            s if is_key_string(s) => Ok(Character(s.to_string())),
            "Unidentified" => Ok(Unidentified),
            "Alt" => Ok(Alt),
            "AltGraph" => Ok(AltGraph),
            "CapsLock" => Ok(CapsLock),
            "Control" => Ok(Control),
            "Fn" => Ok(Fn),
            "FnLock" => Ok(FnLock),
            "Meta" => Ok(Meta),
            "NumLock" => Ok(NumLock),
            "ScrollLock" => Ok(ScrollLock),
            "Shift" => Ok(Shift),
            "Symbol" => Ok(Symbol),
            "SymbolLock" => Ok(SymbolLock),
            "Hyper" => Ok(Hyper),
            "Super" => Ok(Super),
            "Enter" => Ok(Enter),
            "Tab" => Ok(Tab),
            "ArrowDown" => Ok(ArrowDown),
            "ArrowLeft" => Ok(ArrowLeft),
            "ArrowRight" => Ok(ArrowRight),
            "ArrowUp" => Ok(ArrowUp),
            "End" => Ok(End),
            "Home" => Ok(Home),
            "PageDown" => Ok(PageDown),
            "PageUp" => Ok(PageUp),
            "Backspace" => Ok(Backspace),
            "Clear" => Ok(Clear),
            "Copy" => Ok(Copy),
            "CrSel" => Ok(CrSel),
            "Cut" => Ok(Cut),
            "Delete" => Ok(Delete),
            "EraseEof" => Ok(EraseEof),
            "ExSel" => Ok(ExSel),
            "Insert" => Ok(Insert),
            "Paste" => Ok(Paste),
            "Redo" => Ok(Redo),
            "Undo" => Ok(Undo),
            "Accept" => Ok(Accept),
            "Again" => Ok(Again),
            "Attn" => Ok(Attn),
            "Cancel" => Ok(Cancel),
            "ContextMenu" => Ok(ContextMenu),
            "Escape" => Ok(Escape),
            "Execute" => Ok(Execute),
            "Find" => Ok(Find),
            "Help" => Ok(Help),
            "Pause" => Ok(Pause),
            "Play" => Ok(Play),
            "Props" => Ok(Props),
            "Select" => Ok(Select),
            "ZoomIn" => Ok(ZoomIn),
            "ZoomOut" => Ok(ZoomOut),
            "BrightnessDown" => Ok(BrightnessDown),
            "BrightnessUp" => Ok(BrightnessUp),
            "Eject" => Ok(Eject),
            "LogOff" => Ok(LogOff),
            "Power" => Ok(Power),
            "PowerOff" => Ok(PowerOff),
            "PrintScreen" => Ok(PrintScreen),
            "Hibernate" => Ok(Hibernate),
            "Standby" => Ok(Standby),
            "WakeUp" => Ok(WakeUp),
            "AllCandidates" => Ok(AllCandidates),
            "Alphanumeric" => Ok(Alphanumeric),
            "CodeInput" => Ok(CodeInput),
            "Compose" => Ok(Compose),
            "Convert" => Ok(Convert),
            "Dead" => Ok(Dead),
            "FinalMode" => Ok(FinalMode),
            "GroupFirst" => Ok(GroupFirst),
            "GroupLast" => Ok(GroupLast),
            "GroupNext" => Ok(GroupNext),
            "GroupPrevious" => Ok(GroupPrevious),
            "ModeChange" => Ok(ModeChange),
            "NextCandidate" => Ok(NextCandidate),
            "NonConvert" => Ok(NonConvert),
            "PreviousCandidate" => Ok(PreviousCandidate),
            "Process" => Ok(Process),
            "SingleCandidate" => Ok(SingleCandidate),
            "HangulMode" => Ok(HangulMode),
            "HanjaMode" => Ok(HanjaMode),
            "JunjaMode" => Ok(JunjaMode),
            "Eisu" => Ok(Eisu),
            "Hankaku" => Ok(Hankaku),
            "Hiragana" => Ok(Hiragana),
            "HiraganaKatakana" => Ok(HiraganaKatakana),
            "KanaMode" => Ok(KanaMode),
            "KanjiMode" => Ok(KanjiMode),
            "Katakana" => Ok(Katakana),
            "Romaji" => Ok(Romaji),
            "Zenkaku" => Ok(Zenkaku),
            "ZenkakuHankaku" => Ok(ZenkakuHankaku),
            "Soft1" => Ok(Soft1),
            "Soft2" => Ok(Soft2),
            "Soft3" => Ok(Soft3),
            "Soft4" => Ok(Soft4),
            "ChannelDown" => Ok(ChannelDown),
            "ChannelUp" => Ok(ChannelUp),
            "Close" => Ok(Close),
            "MailForward" => Ok(MailForward),
            "MailReply" => Ok(MailReply),
            "MailSend" => Ok(MailSend),
            "MediaClose" => Ok(MediaClose),
            "MediaFastForward" => Ok(MediaFastForward),
            "MediaPause" => Ok(MediaPause),
            "MediaPlay" => Ok(MediaPlay),
            "MediaPlayPause" => Ok(MediaPlayPause),
            "MediaRecord" => Ok(MediaRecord),
            "MediaRewind" => Ok(MediaRewind),
            "MediaStop" => Ok(MediaStop),
            "MediaTrackNext" => Ok(MediaTrackNext),
            "MediaTrackPrevious" => Ok(MediaTrackPrevious),
            "New" => Ok(New),
            "Open" => Ok(Open),
            "Print" => Ok(Print),
            "Save" => Ok(Save),
            "SpellCheck" => Ok(SpellCheck),
            "Key11" => Ok(Key11),
            "Key12" => Ok(Key12),
            "AudioBalanceLeft" => Ok(AudioBalanceLeft),
            "AudioBalanceRight" => Ok(AudioBalanceRight),
            "AudioBassBoostDown" => Ok(AudioBassBoostDown),
            "AudioBassBoostToggle" => Ok(AudioBassBoostToggle),
            "AudioBassBoostUp" => Ok(AudioBassBoostUp),
            "AudioFaderFront" => Ok(AudioFaderFront),
            "AudioFaderRear" => Ok(AudioFaderRear),
            "AudioSurroundModeNext" => Ok(AudioSurroundModeNext),
            "AudioTrebleDown" => Ok(AudioTrebleDown),
            "AudioTrebleUp" => Ok(AudioTrebleUp),
            "AudioVolumeDown" => Ok(AudioVolumeDown),
            "AudioVolumeUp" => Ok(AudioVolumeUp),
            "AudioVolumeMute" => Ok(AudioVolumeMute),
            "MicrophoneToggle" => Ok(MicrophoneToggle),
            "MicrophoneVolumeDown" => Ok(MicrophoneVolumeDown),
            "MicrophoneVolumeUp" => Ok(MicrophoneVolumeUp),
            "MicrophoneVolumeMute" => Ok(MicrophoneVolumeMute),
            "SpeechCorrectionList" => Ok(SpeechCorrectionList),
            "SpeechInputToggle" => Ok(SpeechInputToggle),
            "LaunchApplication1" => Ok(LaunchApplication1),
            "LaunchApplication2" => Ok(LaunchApplication2),
            "LaunchCalendar" => Ok(LaunchCalendar),
            "LaunchContacts" => Ok(LaunchContacts),
            "LaunchMail" => Ok(LaunchMail),
            "LaunchMediaPlayer" => Ok(LaunchMediaPlayer),
            "LaunchMusicPlayer" => Ok(LaunchMusicPlayer),
            "LaunchPhone" => Ok(LaunchPhone),
            "LaunchScreenSaver" => Ok(LaunchScreenSaver),
            "LaunchSpreadsheet" => Ok(LaunchSpreadsheet),
            "LaunchWebBrowser" => Ok(LaunchWebBrowser),
            "LaunchWebCam" => Ok(LaunchWebCam),
            "LaunchWordProcessor" => Ok(LaunchWordProcessor),
            "BrowserBack" => Ok(BrowserBack),
            "BrowserFavorites" => Ok(BrowserFavorites),
            "BrowserForward" => Ok(BrowserForward),
            "BrowserHome" => Ok(BrowserHome),
            "BrowserRefresh" => Ok(BrowserRefresh),
            "BrowserSearch" => Ok(BrowserSearch),
            "BrowserStop" => Ok(BrowserStop),
            "AppSwitch" => Ok(AppSwitch),
            "Call" => Ok(Call),
            "Camera" => Ok(Camera),
            "CameraFocus" => Ok(CameraFocus),
            "EndCall" => Ok(EndCall),
            "GoBack" => Ok(GoBack),
            "GoHome" => Ok(GoHome),
            "HeadsetHook" => Ok(HeadsetHook),
            "LastNumberRedial" => Ok(LastNumberRedial),
            "Notification" => Ok(Notification),
            "MannerMode" => Ok(MannerMode),
            "VoiceDial" => Ok(VoiceDial),
            "TV" => Ok(TV),
            "TV3DMode" => Ok(TV3DMode),
            "TVAntennaCable" => Ok(TVAntennaCable),
            "TVAudioDescription" => Ok(TVAudioDescription),
            "TVAudioDescriptionMixDown" => Ok(TVAudioDescriptionMixDown),
            "TVAudioDescriptionMixUp" => Ok(TVAudioDescriptionMixUp),
            "TVContentsMenu" => Ok(TVContentsMenu),
            "TVDataService" => Ok(TVDataService),
            "TVInput" => Ok(TVInput),
            "TVInputComponent1" => Ok(TVInputComponent1),
            "TVInputComponent2" => Ok(TVInputComponent2),
            "TVInputComposite1" => Ok(TVInputComposite1),
            "TVInputComposite2" => Ok(TVInputComposite2),
            "TVInputHDMI1" => Ok(TVInputHDMI1),
            "TVInputHDMI2" => Ok(TVInputHDMI2),
            "TVInputHDMI3" => Ok(TVInputHDMI3),
            "TVInputHDMI4" => Ok(TVInputHDMI4),
            "TVInputVGA1" => Ok(TVInputVGA1),
            "TVMediaContext" => Ok(TVMediaContext),
            "TVNetwork" => Ok(TVNetwork),
            "TVNumberEntry" => Ok(TVNumberEntry),
            "TVPower" => Ok(TVPower),
            "TVRadioService" => Ok(TVRadioService),
            "TVSatellite" => Ok(TVSatellite),
            "TVSatelliteBS" => Ok(TVSatelliteBS),
            "TVSatelliteCS" => Ok(TVSatelliteCS),
            "TVSatelliteToggle" => Ok(TVSatelliteToggle),
            "TVTerrestrialAnalog" => Ok(TVTerrestrialAnalog),
            "TVTerrestrialDigital" => Ok(TVTerrestrialDigital),
            "TVTimer" => Ok(TVTimer),
            "AVRInput" => Ok(AVRInput),
            "AVRPower" => Ok(AVRPower),
            "ColorF0Red" => Ok(ColorF0Red),
            "ColorF1Green" => Ok(ColorF1Green),
            "ColorF2Yellow" => Ok(ColorF2Yellow),
            "ColorF3Blue" => Ok(ColorF3Blue),
            "ColorF4Grey" => Ok(ColorF4Grey),
            "ColorF5Brown" => Ok(ColorF5Brown),
            "ClosedCaptionToggle" => Ok(ClosedCaptionToggle),
            "Dimmer" => Ok(Dimmer),
            "DisplaySwap" => Ok(DisplaySwap),
            "DVR" => Ok(DVR),
            "Exit" => Ok(Exit),
            "FavoriteClear0" => Ok(FavoriteClear0),
            "FavoriteClear1" => Ok(FavoriteClear1),
            "FavoriteClear2" => Ok(FavoriteClear2),
            "FavoriteClear3" => Ok(FavoriteClear3),
            "FavoriteRecall0" => Ok(FavoriteRecall0),
            "FavoriteRecall1" => Ok(FavoriteRecall1),
            "FavoriteRecall2" => Ok(FavoriteRecall2),
            "FavoriteRecall3" => Ok(FavoriteRecall3),
            "FavoriteStore0" => Ok(FavoriteStore0),
            "FavoriteStore1" => Ok(FavoriteStore1),
            "FavoriteStore2" => Ok(FavoriteStore2),
            "FavoriteStore3" => Ok(FavoriteStore3),
            "Guide" => Ok(Guide),
            "GuideNextDay" => Ok(GuideNextDay),
            "GuidePreviousDay" => Ok(GuidePreviousDay),
            "Info" => Ok(Info),
            "InstantReplay" => Ok(InstantReplay),
            "Link" => Ok(Link),
            "ListProgram" => Ok(ListProgram),
            "LiveContent" => Ok(LiveContent),
            "Lock" => Ok(Lock),
            "MediaApps" => Ok(MediaApps),
            "MediaAudioTrack" => Ok(MediaAudioTrack),
            "MediaLast" => Ok(MediaLast),
            "MediaSkipBackward" => Ok(MediaSkipBackward),
            "MediaSkipForward" => Ok(MediaSkipForward),
            "MediaStepBackward" => Ok(MediaStepBackward),
            "MediaStepForward" => Ok(MediaStepForward),
            "MediaTopMenu" => Ok(MediaTopMenu),
            "NavigateIn" => Ok(NavigateIn),
            "NavigateNext" => Ok(NavigateNext),
            "NavigateOut" => Ok(NavigateOut),
            "NavigatePrevious" => Ok(NavigatePrevious),
            "NextFavoriteChannel" => Ok(NextFavoriteChannel),
            "NextUserProfile" => Ok(NextUserProfile),
            "OnDemand" => Ok(OnDemand),
            "Pairing" => Ok(Pairing),
            "PinPDown" => Ok(PinPDown),
            "PinPMove" => Ok(PinPMove),
            "PinPToggle" => Ok(PinPToggle),
            "PinPUp" => Ok(PinPUp),
            "PlaySpeedDown" => Ok(PlaySpeedDown),
            "PlaySpeedReset" => Ok(PlaySpeedReset),
            "PlaySpeedUp" => Ok(PlaySpeedUp),
            "RandomToggle" => Ok(RandomToggle),
            "RcLowBattery" => Ok(RcLowBattery),
            "RecordSpeedNext" => Ok(RecordSpeedNext),
            "RfBypass" => Ok(RfBypass),
            "ScanChannelsToggle" => Ok(ScanChannelsToggle),
            "ScreenModeNext" => Ok(ScreenModeNext),
            "Settings" => Ok(Settings),
            "SplitScreenToggle" => Ok(SplitScreenToggle),
            "STBInput" => Ok(STBInput),
            "STBPower" => Ok(STBPower),
            "Subtitle" => Ok(Subtitle),
            "Teletext" => Ok(Teletext),
            "VideoModeNext" => Ok(VideoModeNext),
            "Wink" => Ok(Wink),
            "ZoomToggle" => Ok(ZoomToggle),
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

            _ => Err(UnrecognizedKeyError),
        }
    }
}

/// Parse from string error, returned when string does not match to any Key variant.
#[derive(Clone, Debug)]
pub struct UnrecognizedKeyError;

impl fmt::Display for UnrecognizedKeyError {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "Unrecognized key")
    }
}

impl Error for UnrecognizedKeyError {}

/// Check if string can be used as a `Key::Character` _keystring_.
///
/// This check is simple and is meant to prevents common mistakes like mistyped keynames
/// (e.g. `Ennter`) from being recognized as characters.
fn is_key_string(s: &str) -> bool {
    s.chars().all(|c| !c.is_control()) && s.chars().skip(1).all(|c| !c.is_ascii())
}

#[cfg(test)]
mod test {
    use super::*;

    #[test]
    fn test_is_key_string() {
        assert!(is_key_string("A"));
        assert!(!is_key_string("AA"));
        assert!(!is_key_string("	"));
    }
}
    
