use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

const MARKER: &[u8] = b"\x1bP1000p";
const RAW_SENTINEL: &[u8] = b"\x1bP1000r\x1b\\";
const MARKER_WINDOW: usize = 64 * 1024;

#[derive(Debug, PartialEq)]
pub enum Event {
    Passthrough(Vec<u8>),
    RawMode,
    Output { pane: String, data: Vec<u8> },
    Reply { ok: bool, lines: Vec<Vec<u8>> },
}

struct Block {
    number: Vec<u8>,
    ours: bool,
    lines: Vec<Vec<u8>>,
}

#[derive(Default, PartialEq)]
enum Mode {
    #[default]
    Undecided,
    Raw,
    Control,
    Exited,
}

#[derive(Default)]
pub struct Demux {
    mode: Mode,
    scanned: usize,
    buf: Vec<u8>,
    block: Option<Block>,
}

fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack.windows(needle.len()).position(|w| w == needle)
}

fn held_prefix(buf: &[u8], needle: &[u8]) -> usize {
    (1..needle.len())
        .rev()
        .find(|&k| buf.ends_with(&needle[..k]))
        .unwrap_or(0)
}

impl Demux {
    pub fn raw() -> Self {
        Self {
            mode: Mode::Raw,
            ..Self::default()
        }
    }

    pub fn is_control(&self) -> bool {
        self.mode == Mode::Control
    }

    pub fn feed(&mut self, bytes: &[u8]) -> Vec<Event> {
        let mut events = Vec::new();
        match self.mode {
            Mode::Exited => return events,
            Mode::Raw => {
                events.push(Event::Passthrough(bytes.to_vec()));
                return events;
            }
            Mode::Undecided => {
                self.buf.extend_from_slice(bytes);
                if !self.decide(&mut events) {
                    return events;
                }
            }
            Mode::Control => self.buf.extend_from_slice(bytes),
        }
        while let Some(nl) = self.buf.iter().position(|&b| b == b'\n') {
            let mut line: Vec<u8> = self.buf.drain(..=nl).collect();
            line.pop();
            if line.last() == Some(&b'\r') {
                line.pop();
            }
            if let Some(event) = self.line(line) {
                events.push(event);
            }
            if self.mode == Mode::Exited {
                self.buf.clear();
                break;
            }
        }
        events
    }

    fn passthrough(&mut self, end: usize, events: &mut Vec<Event>) {
        if end > 0 {
            events.push(Event::Passthrough(self.buf.drain(..end).collect()));
        }
    }

    fn decide(&mut self, events: &mut Vec<Event>) -> bool {
        let marker = find(&self.buf, MARKER);
        let sentinel = find(&self.buf, RAW_SENTINEL);
        if let Some(m) = marker.filter(|&m| sentinel.is_none_or(|s| m < s)) {
            self.passthrough(m, events);
            self.buf.drain(..MARKER.len());
            self.mode = Mode::Control;
            return true;
        }
        match sentinel {
            Some(s) => {
                self.passthrough(s, events);
                self.buf.drain(..RAW_SENTINEL.len());
                self.go_raw(events);
                false
            }
            None => {
                let held = held_prefix(&self.buf, MARKER).max(held_prefix(&self.buf, RAW_SENTINEL));
                let ready = self.buf.len() - held;
                self.scanned += ready;
                self.passthrough(ready, events);
                if self.scanned >= MARKER_WINDOW {
                    self.go_raw(events);
                }
                false
            }
        }
    }

    fn go_raw(&mut self, events: &mut Vec<Event>) {
        self.mode = Mode::Raw;
        events.push(Event::RawMode);
        let rest = self.buf.len();
        self.passthrough(rest, events);
    }

    fn line(&mut self, line: Vec<u8>) -> Option<Event> {
        let mut fields = line.split(|&b| b == b' ');
        let tag = fields.next().unwrap_or_default();
        if self.block.is_some() {
            let ok = tag == b"%end";
            let number = self.block.as_ref().map(|b| b.number.as_slice());
            let closes = (ok || tag == b"%error") && fields.nth(1) == number;
            if closes {
                let block = self.block.take()?;
                return block.ours.then_some(Event::Reply {
                    ok,
                    lines: block.lines,
                });
            }
            if let Some(block) = self.block.as_mut() {
                block.lines.push(line);
            }
            return None;
        }
        if tag == b"%begin" {
            let number = fields.nth(1)?.to_vec();
            let ours = fields.next() == Some(&b"1"[..]);
            self.block = Some(Block {
                number,
                ours,
                lines: Vec::new(),
            });
            return None;
        }
        if tag == b"%output" {
            let mut parts = line.splitn(3, |&b| b == b' ');
            parts.next();
            let pane = String::from_utf8_lossy(parts.next()?).into_owned();
            let data = decode_octal(parts.next().unwrap_or_default());
            return Some(Event::Output { pane, data });
        }
        if tag == b"%exit" {
            self.mode = Mode::Exited;
        }
        None
    }
}

pub fn decode_octal(data: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(data.len());
    let mut i = 0;
    while i < data.len() {
        let digits = data
            .get(i + 1..i + 4)
            .filter(|d| data[i] == b'\\' && d.iter().all(|b| (b'0'..=b'7').contains(b)));
        match digits {
            Some(d) => {
                let value = d.iter().fold(0u32, |acc, b| acc * 8 + u32::from(b - b'0'));
                out.push(value as u8);
                i += 4;
            }
            None => {
                out.push(data[i]);
                i += 1;
            }
        }
    }
    out
}

const SEND_KEYS_CHUNK: usize = 256;

pub const STATE_FORMAT: &str = "#{pane_id} #{version} #{alternate_on} #{alternate_saved_x} #{alternate_saved_y} #{cursor_x} #{cursor_y} #{cursor_flag} #{insert_flag} #{keypad_cursor_flag} #{keypad_flag} #{mouse_standard_flag} #{mouse_button_flag} #{mouse_all_flag} #{mouse_sgr_flag} #{mouse_utf8_flag} #{wrap_flag} #{origin_flag} #{scroll_region_upper} #{scroll_region_lower} #{history_size} #{pane_height}";

const SYNC_RESET: &str = "\x1b[?1049l\x1b[r\x1b[m\x1b[?6l\x1b[?7h\x1b[4l\x1b[?1l\x1b>\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1005l\x1b[?1006l\x1b[?25h\x1b[H\x1b[2J\x1b[3J";

#[derive(Debug, Clone, PartialEq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalColors {
    pub fg: String,
    pub bg: String,
    pub selection_fg: String,
    pub selection_bg: String,
}

impl TerminalColors {
    pub fn is_valid(&self) -> bool {
        [&self.fg, &self.bg, &self.selection_fg, &self.selection_bg]
            .iter()
            .all(|c| {
                c.len() == 7 && c.starts_with('#') && c[1..].bytes().all(|b| b.is_ascii_hexdigit())
            })
    }
}

pub fn encode_input(target: &str, bytes: &[u8]) -> Vec<String> {
    bytes
        .chunks(SEND_KEYS_CHUNK)
        .map(|chunk| {
            let hex: Vec<String> = chunk.iter().map(|b| format!("{b:02x}")).collect();
            format!("send-keys -H -t {target} {}\n", hex.join(" "))
        })
        .collect()
}

pub fn encode_resize(cols: u32, rows: u32) -> String {
    format!("refresh-client -C {cols}x{rows}\n")
}

pub fn window_style_command(target: &str, colors: &TerminalColors) -> String {
    format!(
        "set -p -t {target} window-style 'fg={},bg={}'\n",
        colors.fg, colors.bg
    )
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum ReplyKind {
    Ignore,
    State,
    History,
    Saved,
    Visible,
}

#[derive(Debug, Default, Clone, PartialEq)]
pub struct PaneState {
    pub pane_id: String,
    pub version: String,
    pub alternate_on: bool,
    pub saved_x: u32,
    pub saved_y: u32,
    pub cursor_x: u32,
    pub cursor_y: u32,
    pub cursor_visible: bool,
    pub insert: bool,
    pub app_cursor: bool,
    pub app_keypad: bool,
    pub mouse_standard: bool,
    pub mouse_button: bool,
    pub mouse_all: bool,
    pub mouse_sgr: bool,
    pub mouse_utf8: bool,
    pub wrap: bool,
    pub origin: bool,
    pub scroll_upper: u32,
    pub scroll_lower: u32,
    pub history_size: u32,
    pub pane_height: u32,
}

impl PaneState {
    pub fn parse(line: &[u8]) -> Option<Self> {
        let text = std::str::from_utf8(line).ok()?;
        let f: Vec<&str> = text.split(' ').collect();
        if f.len() != 22 {
            return None;
        }
        let n = |i: usize| f[i].parse::<u32>().unwrap_or(0);
        let b = |i: usize| f[i] == "1";
        Some(Self {
            pane_id: f[0].to_string(),
            version: f[1].to_string(),
            alternate_on: b(2),
            saved_x: n(3),
            saved_y: n(4),
            cursor_x: n(5),
            cursor_y: n(6),
            cursor_visible: b(7),
            insert: b(8),
            app_cursor: b(9),
            app_keypad: b(10),
            mouse_standard: b(11),
            mouse_button: b(12),
            mouse_all: b(13),
            mouse_sgr: b(14),
            mouse_utf8: b(15),
            wrap: b(16),
            origin: b(17),
            scroll_upper: n(18),
            scroll_lower: n(19),
            history_size: n(20),
            pane_height: n(21),
        })
    }
}

pub fn sync_command(
    key: &str,
    cols: u32,
    rows: u32,
    colors: Option<&TerminalColors>,
) -> (String, Vec<ReplyKind>) {
    let mut cmds = vec![
        (encode_resize(cols, rows), ReplyKind::Ignore),
        ("set -g window-size smallest".to_string(), ReplyKind::Ignore),
    ];
    if let Some(c) = colors {
        cmds.push((window_style_command(key, c), ReplyKind::Ignore));
    }
    cmds.push((
        format!("display -p -t {key} '{STATE_FORMAT}'"),
        ReplyKind::State,
    ));
    cmds.push((
        format!("capture-pane -p -e -J -t {key} -S -50000 -E -1"),
        ReplyKind::History,
    ));
    cmds.push((
        format!("capture-pane -p -e -q -a -t {key}"),
        ReplyKind::Saved,
    ));
    cmds.push((format!("capture-pane -p -e -t {key}"), ReplyKind::Visible));
    let line: Vec<&str> = cmds.iter().map(|(c, _)| c.trim_end()).collect();
    (
        format!("{}\n", line.join(" ; ")),
        cmds.into_iter().map(|(_, k)| k).collect(),
    )
}

fn cup(out: &mut Vec<u8>, y: u32, x: u32) {
    out.extend_from_slice(format!("\x1b[{};{}H", y + 1, x + 1).as_bytes());
}

fn push_row(out: &mut Vec<u8>, row: &[u8]) {
    out.extend_from_slice(row);
    out.extend_from_slice(b"\x1b[m");
}

pub fn sync_bytes(
    s: &PaneState,
    history: &[Vec<u8>],
    saved: &[Vec<u8>],
    visible: &[Vec<u8>],
    rows: u32,
) -> Vec<u8> {
    let mut out = SYNC_RESET.as_bytes().to_vec();
    let history = if s.history_size == 0 {
        &[][..]
    } else {
        history
    };
    let normal = if s.alternate_on { saved } else { visible };
    let blank = Vec::new();
    let padding = (s.pane_height.max(rows) as usize).saturating_sub(normal.len());
    let lines = history
        .iter()
        .chain(normal)
        .chain(std::iter::repeat_n(&blank, padding));
    for (i, line) in lines.enumerate() {
        if i > 0 {
            out.extend_from_slice(b"\r\n");
        }
        push_row(&mut out, line);
    }
    if s.alternate_on {
        cup(&mut out, s.saved_y, s.saved_x);
        out.extend_from_slice(b"\x1b[?1049h");
        for (y, line) in visible.iter().enumerate() {
            cup(&mut out, y as u32, 0);
            push_row(&mut out, line);
        }
    }
    out.extend_from_slice(
        format!("\x1b[{};{}r", s.scroll_upper + 1, s.scroll_lower + 1).as_bytes(),
    );
    if s.origin {
        out.extend_from_slice(b"\x1b[?6h");
    }
    let y = if s.origin {
        s.cursor_y.saturating_sub(s.scroll_upper)
    } else {
        s.cursor_y
    };
    cup(&mut out, y, s.cursor_x);
    let modes: [(bool, &[u8]); 10] = [
        (!s.wrap, b"\x1b[?7l"),
        (s.insert, b"\x1b[4h"),
        (s.app_cursor, b"\x1b[?1h"),
        (s.app_keypad, b"\x1b="),
        (s.mouse_standard, b"\x1b[?1000h"),
        (s.mouse_button, b"\x1b[?1002h"),
        (s.mouse_all, b"\x1b[?1003h"),
        (s.mouse_utf8, b"\x1b[?1005h"),
        (s.mouse_sgr, b"\x1b[?1006h"),
        (!s.cursor_visible, b"\x1b[?25l"),
    ];
    for (on, seq) in modes {
        if on {
            out.extend_from_slice(seq);
        }
    }
    out
}

#[derive(Debug, PartialEq)]
pub enum Action {
    Emit(Vec<u8>),
    Send(Vec<u8>),
    WindowChange(u32, u32),
    Started { tmux: String },
}

#[derive(Default)]
struct Snapshot {
    state: Option<PaneState>,
    history: Vec<Vec<u8>>,
    saved: Vec<Vec<u8>>,
    replies_left: usize,
}

enum Phase {
    Undecided(Vec<u8>),
    Raw,
    Control,
}

pub struct ControlSession {
    key: String,
    cols: u32,
    rows: u32,
    colors: Option<TerminalColors>,
    demux: Demux,
    phase: Phase,
    pending: VecDeque<ReplyKind>,
    snapshot: Option<Snapshot>,
    pane: Option<String>,
    osc7: Arc<AtomicBool>,
}

impl ControlSession {
    pub fn new(key: String, cols: u32, rows: u32, colors: Option<TerminalColors>) -> Self {
        Self {
            key,
            cols,
            rows,
            colors,
            demux: Demux::default(),
            phase: Phase::Undecided(Vec::new()),
            pending: VecDeque::new(),
            snapshot: None,
            pane: None,
            osc7: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn raw() -> Self {
        Self {
            demux: Demux::raw(),
            phase: Phase::Raw,
            ..Self::new(String::new(), 0, 0, None)
        }
    }

    pub fn osc7_flag(&self) -> Arc<AtomicBool> {
        Arc::clone(&self.osc7)
    }

    fn target(&self) -> &str {
        self.pane.as_deref().unwrap_or(&self.key)
    }

    fn command(&mut self, cmd: String) -> Action {
        self.pending.push_back(ReplyKind::Ignore);
        Action::Send(cmd.into_bytes())
    }

    fn send_keys(&mut self, data: &[u8]) -> Vec<Action> {
        let target = self.target().to_string();
        encode_input(&target, data)
            .into_iter()
            .map(|cmd| self.command(cmd))
            .collect()
    }

    pub fn on_output(&mut self, bytes: &[u8]) -> Vec<Action> {
        let was_control = self.demux.is_control();
        let mut actions = Vec::new();
        for event in self.demux.feed(bytes) {
            match event {
                Event::Passthrough(data) => actions.push(Action::Emit(data)),
                Event::RawMode => {
                    if let Phase::Undecided(queued) = std::mem::replace(&mut self.phase, Phase::Raw)
                    {
                        if !queued.is_empty() {
                            actions.push(Action::Send(queued));
                        }
                    }
                }
                Event::Output { pane, data } => {
                    let ours = self.pane.as_ref().is_none_or(|p| *p == pane);
                    if self.snapshot.is_none() && ours {
                        if find(&data, b"\x1b]7;").is_some() {
                            self.osc7.store(true, Ordering::Relaxed);
                        }
                        actions.push(Action::Emit(data));
                    }
                }
                Event::Reply { ok, lines } => self.reply(ok, lines, &mut actions),
            }
        }
        if !was_control && self.demux.is_control() {
            let queued = match std::mem::replace(&mut self.phase, Phase::Control) {
                Phase::Undecided(queued) => queued,
                _ => Vec::new(),
            };
            let (line, kinds) = sync_command(&self.key, self.cols, self.rows, self.colors.as_ref());
            self.snapshot = Some(Snapshot {
                replies_left: kinds.len(),
                ..Snapshot::default()
            });
            self.pending.extend(kinds);
            actions.push(Action::Send(line.into_bytes()));
            if !queued.is_empty() {
                actions.extend(self.send_keys(&queued));
            }
        }
        actions
    }

    // tmux stops a `;` list at its first error, so the rest of the sync never replies.
    fn reply(&mut self, ok: bool, lines: Vec<Vec<u8>>, actions: &mut Vec<Action>) {
        let Some(kind) = self.pending.pop_front() else {
            return;
        };
        let Some(snapshot) = self.snapshot.as_mut() else {
            return;
        };
        snapshot.replies_left -= 1;
        if !ok {
            let rest = snapshot.replies_left;
            self.snapshot = None;
            self.pending.drain(..rest.min(self.pending.len()));
            actions.push(Action::Started {
                tmux: String::new(),
            });
            return;
        }
        match kind {
            ReplyKind::Ignore => {}
            ReplyKind::State => snapshot.state = lines.first().and_then(|l| PaneState::parse(l)),
            ReplyKind::History => snapshot.history = lines,
            ReplyKind::Saved => snapshot.saved = lines,
            ReplyKind::Visible => {
                let Some(snapshot) = self.snapshot.take() else {
                    return;
                };
                match snapshot.state {
                    Some(state) => {
                        self.pane = Some(state.pane_id.clone());
                        actions.push(Action::Started {
                            tmux: state.version.clone(),
                        });
                        actions.push(Action::Emit(sync_bytes(
                            &state,
                            &snapshot.history,
                            &snapshot.saved,
                            &lines,
                            self.rows,
                        )));
                    }
                    None => actions.push(Action::Started {
                        tmux: String::new(),
                    }),
                }
            }
        }
    }

    pub fn on_input(&mut self, data: Vec<u8>) -> Vec<Action> {
        match &mut self.phase {
            Phase::Undecided(queued) => {
                queued.extend(data);
                Vec::new()
            }
            Phase::Raw => vec![Action::Send(data)],
            Phase::Control => self.send_keys(&data),
        }
    }

    pub fn on_resize(&mut self, cols: u32, rows: u32) -> Vec<Action> {
        self.cols = cols;
        self.rows = rows;
        match self.phase {
            Phase::Control => vec![self.command(encode_resize(cols, rows))],
            _ => vec![Action::WindowChange(cols, rows)],
        }
    }

    pub fn on_colors(&mut self, colors: TerminalColors) -> Vec<Action> {
        let cmd = window_style_command(self.target(), &colors);
        self.colors = Some(colors);
        match self.phase {
            Phase::Control => vec![self.command(cmd)],
            _ => Vec::new(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn out(pane: &str, data: &[u8]) -> Event {
        Event::Output {
            pane: pane.into(),
            data: data.to_vec(),
        }
    }

    #[test]
    fn passes_bytes_through_until_the_marker() {
        let mut d = Demux::default();
        let events = d.feed(b"MOTD\r\n\x1bP1000p%output %0 hi\\015\\012\r\n");
        assert_eq!(
            events,
            vec![
                Event::Passthrough(b"MOTD\r\n".to_vec()),
                out("%0", b"hi\r\n")
            ]
        );
        assert!(d.is_control());
    }

    #[test]
    fn marker_split_across_reads() {
        let mut d = Demux::default();
        assert_eq!(
            d.feed(b"ab\x1bP10"),
            vec![Event::Passthrough(b"ab".to_vec())]
        );
        assert!(!d.is_control());
        assert_eq!(d.feed(b"00p%output %0 x\r\n"), vec![out("%0", b"x")]);
        assert!(d.is_control());
    }

    #[test]
    fn held_escape_is_released_when_it_is_not_the_marker() {
        let mut d = Demux::default();
        assert_eq!(
            d.feed(b"abc\x1b"),
            vec![Event::Passthrough(b"abc".to_vec())]
        );
        assert_eq!(d.feed(b"[m"), vec![Event::Passthrough(b"\x1b[m".to_vec())]);
        assert!(!d.is_control());
    }

    #[test]
    fn without_marker_or_sentinel_the_stream_turns_raw_after_the_window() {
        let mut d = Demux::default();
        let filler = vec![b'x'; MARKER_WINDOW + 10];
        assert_eq!(
            d.feed(&filler),
            vec![Event::Passthrough(filler.clone()), Event::RawMode]
        );
        let events = d.feed(b"\x1bP1000p%exit\r\n");
        assert_eq!(
            events,
            vec![Event::Passthrough(b"\x1bP1000p%exit\r\n".to_vec())]
        );
        assert!(!d.is_control());
    }

    #[test]
    fn bytes_held_at_the_window_boundary_are_flushed() {
        let mut d = Demux::default();
        let mut chunk = vec![b'x'; MARKER_WINDOW + 10];
        chunk.push(0x1b);
        let mut out = Vec::new();
        for e in d.feed(&chunk).into_iter().chain(d.feed(b"[1m")) {
            if let Event::Passthrough(b) = e {
                out.extend(b);
            }
        }
        chunk.extend_from_slice(b"[1m");
        assert_eq!(out, chunk);
    }

    #[test]
    fn raw_sentinel_decides_raw_and_is_stripped() {
        let mut d = Demux::default();
        assert_eq!(
            d.feed(b"motd\x1bP1000r\x1b\\$ prompt"),
            vec![
                Event::Passthrough(b"motd".to_vec()),
                Event::RawMode,
                Event::Passthrough(b"$ prompt".to_vec())
            ]
        );
        assert_eq!(
            d.feed(b"\x1bP1000p"),
            vec![Event::Passthrough(b"\x1bP1000p".to_vec())]
        );
        assert!(!d.is_control());
    }

    #[test]
    fn raw_sentinel_split_across_reads() {
        let mut d = Demux::default();
        assert_eq!(
            d.feed(b"a\x1bP100"),
            vec![Event::Passthrough(b"a".to_vec())]
        );
        assert_eq!(d.feed(b"0r\x1b"), vec![]);
        assert_eq!(
            d.feed(b"\\b"),
            vec![Event::RawMode, Event::Passthrough(b"b".to_vec())]
        );
    }

    #[test]
    fn raw_demux_never_scans() {
        let mut d = Demux::raw();
        assert_eq!(
            d.feed(b"\x1bP1000p"),
            vec![Event::Passthrough(b"\x1bP1000p".to_vec())]
        );
    }

    #[test]
    fn line_split_across_reads() {
        let mut d = Demux::default();
        d.feed(b"\x1bP1000p");
        assert!(d.feed(b"%output %0 ab").is_empty());
        assert_eq!(d.feed(b"c\r\n"), vec![out("%0", b"abc")]);
    }

    #[test]
    fn octal_escapes_decode_and_high_bytes_pass_raw() {
        assert_eq!(decode_octal(b"A\\134Z\\033[1m"), b"A\\Z\x1b[1m".to_vec());
        assert_eq!(decode_octal("é😀".as_bytes()), "é😀".as_bytes().to_vec());
        assert_eq!(decode_octal(b"trailing\\01"), b"trailing\\01".to_vec());
        assert_eq!(decode_octal(b"\\9zz"), b"\\9zz".to_vec());
    }

    #[test]
    fn only_our_reply_blocks_surface_in_order() {
        let mut d = Demux::default();
        d.feed(b"\x1bP1000p");
        let events = d.feed(
            b"%begin 1 5 0\r\n%end 1 5 0\r\n\
              %begin 1 6 1\r\nline a\r\nline b\r\n%end 1 6 1\r\n\
              %begin 1 7 1\r\nbad\r\n%error 1 7 1\r\n",
        );
        assert_eq!(
            events,
            vec![
                Event::Reply {
                    ok: true,
                    lines: vec![b"line a".to_vec(), b"line b".to_vec()]
                },
                Event::Reply {
                    ok: false,
                    lines: vec![b"bad".to_vec()]
                },
            ]
        );
    }

    #[test]
    fn captured_text_that_looks_like_a_guard_does_not_close_the_block() {
        let mut d = Demux::default();
        d.feed(b"\x1bP1000p");
        let events = d.feed(b"%begin 1 7 1\r\n%end 1 6 1\r\n%output %9 no\r\n%end 1 7 1\r\n");
        assert_eq!(
            events,
            vec![Event::Reply {
                ok: true,
                lines: vec![b"%end 1 6 1".to_vec(), b"%output %9 no".to_vec()]
            }]
        );
    }

    #[test]
    fn unknown_notifications_are_ignored() {
        let mut d = Demux::default();
        d.feed(b"\x1bP1000p");
        let events =
            d.feed(b"%session-changed $0 s\r\n%layout-change @0 x\r\n%window-renamed @0 sh\r\n");
        assert!(events.is_empty());
    }

    #[test]
    fn exit_ends_the_stream() {
        let mut d = Demux::default();
        d.feed(b"\x1bP1000p");
        assert!(d.feed(b"%exit\r\n\x1b\\").is_empty());
        assert!(d.feed(b"%output %0 late\r\n").is_empty());
    }

    fn colors() -> TerminalColors {
        TerminalColors {
            fg: "#101820".into(),
            bg: "#fafaf0".into(),
            selection_fg: "#101820".into(),
            selection_bg: "#c8d0e0".into(),
        }
    }

    const STATE_3_2A: &[u8] =
        b"%0 3.2a 0 4294967295 4294967295 2 0 1 0 0 0 0 0 0 0 0 1 0 0 29 0 30";

    #[test]
    fn encode_input_is_hex_send_keys_in_bounded_chunks() {
        assert_eq!(
            encode_input("%0", b"ls\r"),
            vec!["send-keys -H -t %0 6c 73 0d\n".to_string()]
        );
        let cmds = encode_input("%3", &[0xc3; 300]);
        assert_eq!(cmds.len(), 2);
        assert_eq!(cmds[0].matches("c3").count(), 256);
        assert_eq!(cmds[1].matches("c3").count(), 44);
        assert!(cmds
            .iter()
            .all(|c| c.starts_with("send-keys -H -t %3 ") && c.ends_with('\n')));
    }

    #[test]
    fn encode_input_chunks_a_megabyte_paste() {
        let cmds = encode_input("%0", &vec![b'a'; 1 << 20]);
        assert_eq!(cmds.len(), 4096);
        assert!(cmds.iter().all(|c| c.len() < 1100));
    }

    #[test]
    fn resize_and_window_style_commands() {
        assert_eq!(encode_resize(120, 40), "refresh-client -C 120x40\n");
        assert_eq!(
            window_style_command("voltius_s1", &colors()),
            "set -p -t voltius_s1 window-style 'fg=#101820,bg=#fafaf0'\n"
        );
    }

    #[test]
    fn only_six_digit_hex_colours_are_valid() {
        assert!(colors().is_valid());
        for bad in ["red", "#fff", "#12345g", "#1234567", "'; rm -rf /", ""] {
            let c = TerminalColors {
                bg: bad.into(),
                ..colors()
            };
            assert!(!c.is_valid(), "{bad}");
        }
    }

    #[test]
    fn pane_state_parses_the_real_reply() {
        let s = PaneState::parse(STATE_3_2A).expect("parses");
        assert_eq!(s.pane_id, "%0");
        assert_eq!(s.version, "3.2a");
        assert!(!s.alternate_on);
        assert_eq!((s.cursor_x, s.cursor_y), (2, 0));
        assert!(s.cursor_visible && s.wrap && !s.origin);
        assert_eq!((s.scroll_upper, s.scroll_lower), (0, 29));
        assert_eq!((s.history_size, s.pane_height), (0, 30));
        assert!(PaneState::parse(b"%0 3.2a 0").is_none());
    }

    #[test]
    fn sync_command_is_one_atomic_line_with_matching_reply_kinds() {
        let (line, kinds) = sync_command("voltius_s1", 100, 30, Some(&colors()));
        assert!(line.ends_with('\n'));
        assert_eq!(line.matches('\n').count(), 1);
        let cmds: Vec<&str> = line.trim_end().split(" ; ").collect();
        assert_eq!(cmds.len(), kinds.len());
        assert_eq!(cmds[0], "refresh-client -C 100x30");
        assert_eq!(cmds[1], "set -g window-size smallest");
        assert!(cmds[2].starts_with("set -p -t voltius_s1 window-style"));
        assert_eq!(
            cmds[3],
            format!("display -p -t voltius_s1 '{STATE_FORMAT}'")
        );
        assert_eq!(
            cmds[4],
            "capture-pane -p -e -J -t voltius_s1 -S -50000 -E -1"
        );
        assert_eq!(cmds[5], "capture-pane -p -e -q -a -t voltius_s1");
        assert_eq!(cmds[6], "capture-pane -p -e -t voltius_s1");
        use ReplyKind::*;
        assert_eq!(
            kinds,
            vec![Ignore, Ignore, Ignore, State, History, Saved, Visible]
        );
        let (bare, bare_kinds) = sync_command("voltius_s1", 80, 24, None);
        assert!(!bare.contains("window-style"));
        assert_eq!(
            bare_kinds,
            vec![Ignore, Ignore, State, History, Saved, Visible]
        );
    }

    fn rows(lines: &[&str]) -> Vec<Vec<u8>> {
        lines.iter().map(|l| l.as_bytes().to_vec()).collect()
    }

    fn state(height: u32) -> PaneState {
        PaneState {
            pane_id: "%0".into(),
            cursor_visible: true,
            wrap: true,
            scroll_lower: height - 1,
            pane_height: height,
            ..PaneState::default()
        }
    }

    #[test]
    fn sync_writes_history_then_screen_then_cursor() {
        let s = PaneState {
            history_size: 2,
            cursor_x: 3,
            cursor_y: 1,
            ..state(2)
        };
        let bytes = sync_bytes(&s, &rows(&["h1", "h2"]), &[], &rows(&["s1", "s2"]), 2);
        let text = String::from_utf8(bytes).unwrap();
        assert!(text.starts_with(SYNC_RESET));
        let body = &text[SYNC_RESET.len()..];
        assert!(body.starts_with("h1\x1b[m\r\nh2\x1b[m\r\ns1\x1b[m\r\ns2\x1b[m"));
        assert!(body.ends_with("\x1b[1;2r\x1b[2;4H"));
        assert!(!body.contains("?1049h"));
    }

    #[test]
    fn sync_ignores_history_when_history_size_is_zero() {
        let s = state(2);
        let text =
            String::from_utf8(sync_bytes(&s, &rows(&["$ "]), &[], &rows(&["$ ", ""]), 2)).unwrap();
        assert_eq!(text.matches("$ ").count(), 1);
    }

    #[test]
    fn sync_pads_the_normal_screen_to_pane_height() {
        let s = PaneState {
            history_size: 1,
            ..state(3)
        };
        let text =
            String::from_utf8(sync_bytes(&s, &rows(&["h"]), &[], &rows(&["$ "]), 3)).unwrap();
        let body = &text[SYNC_RESET.len()..];
        assert_eq!(body.matches("\r\n").count(), 3);
    }

    #[test]
    fn sync_pads_to_the_client_rows_when_the_pane_is_shorter() {
        let s = PaneState {
            history_size: 1,
            ..state(3)
        };
        let text = String::from_utf8(sync_bytes(
            &s,
            &rows(&["h"]),
            &[],
            &rows(&["a", "b", "c"]),
            5,
        ))
        .unwrap();
        let body = &text[SYNC_RESET.len()..];
        assert_eq!(body.matches("\r\n").count(), 5);
    }

    #[test]
    fn sync_rebuilds_the_alternate_screen_over_the_saved_one() {
        let s = PaneState {
            alternate_on: true,
            saved_x: 0,
            saved_y: 2,
            cursor_x: 2,
            cursor_y: 4,
            app_cursor: true,
            app_keypad: true,
            mouse_button: true,
            mouse_sgr: true,
            scroll_upper: 2,
            scroll_lower: 7,
            ..state(10)
        };
        let text = String::from_utf8(sync_bytes(
            &s,
            &[],
            &rows(&["n1", "n2"]),
            &rows(&["", "", "", "", "  ALT"]),
            10,
        ))
        .unwrap();
        let alt = text.find("\x1b[?1049h").expect("enters alternate screen");
        assert!(text[..alt].contains("n1\x1b[m\r\nn2"));
        assert!(text[..alt].ends_with("\x1b[3;1H"));
        assert!(text[alt..].contains("\x1b[5;1H  ALT"));
        let tail = &text[text.rfind("\x1b[3;8r").expect("scroll region")..];
        assert_eq!(
            tail,
            "\x1b[3;8r\x1b[5;3H\x1b[?1h\x1b=\x1b[?1002h\x1b[?1006h"
        );
    }

    #[test]
    fn sync_restores_origin_relative_cursor_and_hidden_cursor() {
        let s = PaneState {
            origin: true,
            cursor_visible: false,
            scroll_upper: 2,
            scroll_lower: 7,
            cursor_y: 4,
            ..state(10)
        };
        let text = String::from_utf8(sync_bytes(&s, &[], &[], &rows(&[""]), 10)).unwrap();
        assert!(text.ends_with("\x1b[3;8r\x1b[?6h\x1b[3;1H\x1b[?25l"));
    }

    fn begin_end(number: u32, lines: &[&str]) -> Vec<u8> {
        let mut out = format!("%begin 1 {number} 1\r\n").into_bytes();
        for l in lines {
            out.extend_from_slice(l.as_bytes());
            out.extend_from_slice(b"\r\n");
        }
        out.extend_from_slice(format!("%end 1 {number} 1\r\n").as_bytes());
        out
    }

    fn started_session() -> ControlSession {
        let mut s = ControlSession::new("voltius_s1".into(), 80, 2, None);
        let actions = s.on_output(b"motd\r\n\x1bP1000p%begin 1 1 0\r\n%end 1 1 0\r\n");
        let (line, _) = sync_command("voltius_s1", 80, 2, None);
        assert_eq!(
            actions,
            vec![
                Action::Emit(b"motd\r\n".to_vec()),
                Action::Send(line.into_bytes())
            ]
        );
        s
    }

    const STATE_2_ROWS: &str = "%0 3.6 0 4294967295 4294967295 2 1 1 0 0 0 0 0 0 0 0 1 0 0 1 1 2";

    fn finish_sync(s: &mut ControlSession, first: u32) -> Vec<Action> {
        let mut replies = begin_end(first, &[]);
        replies.extend(begin_end(first + 1, &[]));
        replies.extend(begin_end(first + 2, &[STATE_2_ROWS]));
        replies.extend(begin_end(first + 3, &["old"]));
        replies.extend(begin_end(first + 4, &[]));
        replies.extend(begin_end(first + 5, &["$ ls", "$ "]));
        s.on_output(&replies)
    }

    #[test]
    fn raw_session_passes_everything_straight_through() {
        let mut s = ControlSession::raw();
        assert_eq!(
            s.on_output(b"hello\x1bP1000p"),
            vec![Action::Emit(b"hello\x1bP1000p".to_vec())]
        );
        assert_eq!(
            s.on_input(b"ls\r".to_vec()),
            vec![Action::Send(b"ls\r".to_vec())]
        );
        assert_eq!(s.on_resize(100, 30), vec![Action::WindowChange(100, 30)]);
        assert!(s.on_colors(colors()).is_empty());
    }

    #[test]
    fn input_waits_for_the_multiplexer_decision_then_goes_raw() {
        let mut s = ControlSession::new("voltius_s1".into(), 80, 24, None);
        assert!(s.on_input(b"export A=1\n".to_vec()).is_empty());
        assert_eq!(
            s.on_output(b"banner "),
            vec![Action::Emit(b"banner ".to_vec())]
        );
        assert_eq!(
            s.on_output(b"\x1bP1000r\x1b\\$ "),
            vec![
                Action::Send(b"export A=1\n".to_vec()),
                Action::Emit(b"$ ".to_vec())
            ]
        );
        assert_eq!(
            s.on_input(b"ls\r".to_vec()),
            vec![Action::Send(b"ls\r".to_vec())]
        );
    }

    #[test]
    fn queued_input_follows_the_sync_line_as_send_keys() {
        let mut s = ControlSession::new("voltius_s1".into(), 80, 24, None);
        assert!(s.on_input(b"ls\r".to_vec()).is_empty());
        let (line, _) = sync_command("voltius_s1", 80, 24, None);
        assert_eq!(
            s.on_output(b"\x1bP1000p"),
            vec![
                Action::Send(line.into_bytes()),
                Action::Send(b"send-keys -H -t voltius_s1 6c 73 0d\n".to_vec())
            ]
        );
    }

    #[test]
    fn a_sync_error_abandons_the_snapshot_and_streams() {
        let mut s = started_session();
        let mut replies = begin_end(2, &[]);
        replies.extend(begin_end(3, &[]));
        replies.extend(b"%begin 1 4 1\r\nno such session\r\n%error 1 4 1\r\n");
        assert_eq!(
            s.on_output(&replies),
            vec![Action::Started {
                tmux: String::new()
            }]
        );
        assert_eq!(
            s.on_output(b"%output %0 x\r\n"),
            vec![Action::Emit(b"x".to_vec())]
        );
        s.on_input(b"y".to_vec());
        assert!(s.on_output(&begin_end(5, &["late"])).is_empty());
        assert_eq!(
            s.on_output(b"%output %0 z\r\n"),
            vec![Action::Emit(b"z".to_vec())]
        );
    }

    #[test]
    fn osc7_in_control_output_is_flagged() {
        let mut s = started_session();
        finish_sync(&mut s, 2);
        let flag = s.osc7_flag();
        assert!(!flag.load(std::sync::atomic::Ordering::Relaxed));
        s.on_output(b"%output %0 \\033]7;file://h/tmp\\007\r\n");
        assert!(flag.load(std::sync::atomic::Ordering::Relaxed));
    }

    #[test]
    fn marker_starts_the_sync_and_the_snapshot_replaces_held_output() {
        let mut s = started_session();
        assert!(s
            .on_output(b"%output %0 already-in-snapshot\r\n")
            .is_empty());
        let actions = finish_sync(&mut s, 2);
        let state = PaneState::parse(STATE_2_ROWS.as_bytes()).unwrap();
        let expected = sync_bytes(&state, &rows(&["old"]), &[], &rows(&["$ ls", "$ "]), 2);
        assert_eq!(
            actions,
            vec![
                Action::Started { tmux: "3.6".into() },
                Action::Emit(expected)
            ]
        );
        assert_eq!(
            s.on_output(b"%output %0 live\\015\\012\r\n"),
            vec![Action::Emit(b"live\r\n".to_vec())]
        );
        assert!(s.on_output(b"%output %7 other-pane\r\n").is_empty());
    }

    #[test]
    fn control_input_and_resize_become_commands_targeting_the_pane() {
        let mut s = started_session();
        finish_sync(&mut s, 2);
        assert_eq!(
            s.on_input(b"ls\r".to_vec()),
            vec![Action::Send(b"send-keys -H -t %0 6c 73 0d\n".to_vec())]
        );
        assert_eq!(
            s.on_resize(120, 40),
            vec![Action::Send(b"refresh-client -C 120x40\n".to_vec())]
        );
        assert_eq!(
            s.on_colors(colors()),
            vec![Action::Send(
                b"set -p -t %0 window-style 'fg=#101820,bg=#fafaf0'\n".to_vec()
            )]
        );
    }

    #[test]
    fn input_and_resize_during_sync_keep_reply_order() {
        let mut s = started_session();
        let typed = s.on_input(b"x".to_vec());
        assert_eq!(
            typed,
            vec![Action::Send(b"send-keys -H -t voltius_s1 78\n".to_vec())]
        );
        s.on_resize(90, 2);
        let actions = finish_sync(&mut s, 2);
        assert!(matches!(
            actions.as_slice(),
            [Action::Started { .. }, Action::Emit(_)]
        ));
        let mut late = begin_end(8, &["ignored"]);
        late.extend(begin_end(9, &[]));
        assert!(s.on_output(&late).is_empty());
    }

    #[test]
    fn colours_given_at_connect_go_into_the_sync_line() {
        let mut s = ControlSession::new("voltius_s1".into(), 80, 24, Some(colors()));
        let actions = s.on_output(b"\x1bP1000p");
        let (line, _) = sync_command("voltius_s1", 80, 24, Some(&colors()));
        assert_eq!(actions, vec![Action::Send(line.into_bytes())]);
    }

    #[test]
    fn unparsable_state_still_streams_without_a_snapshot() {
        let mut s = started_session();
        let mut replies = begin_end(2, &[]);
        replies.extend(begin_end(3, &[]));
        replies.extend(begin_end(4, &["garbage"]));
        replies.extend(begin_end(5, &[]));
        replies.extend(begin_end(6, &[]));
        replies.extend(begin_end(7, &["$ "]));
        assert_eq!(
            s.on_output(&replies),
            vec![Action::Started {
                tmux: String::new()
            }]
        );
        assert_eq!(
            s.on_output(b"%output %4 x\r\n"),
            vec![Action::Emit(b"x".to_vec())]
        );
    }
}

#[cfg(test)]
mod docker_harness {
    use super::*;
    use std::io::{Read, Write};
    use std::process::{Command, Stdio};
    use std::sync::mpsc;
    use std::time::{Duration, Instant};

    const IMAGES: &[(&str, &str)] = &[
        ("tmuxh:ubuntu-22-04", "ubuntu:22.04"),
        ("tmuxh:debian-bookworm", "debian:bookworm"),
        ("tmuxh:ubuntu-24-04", "ubuntu:24.04"),
        ("tmuxh:debian-trixie-slim", "debian:trixie-slim"),
        ("tmuxh:ubuntu-26-04", "ubuntu:26.04"),
    ];

    fn docker(args: &[&str]) -> std::process::Output {
        Command::new("docker")
            .args(args)
            .output()
            .expect("docker runs")
    }

    fn ensure_image(tag: &str, base: &str) {
        if docker(&["image", "inspect", tag]).status.success() {
            return;
        }
        let dockerfile = format!(
            "FROM {base}\nRUN apt-get -qq update && DEBIAN_FRONTEND=noninteractive apt-get -qq install -y tmux >/dev/null && rm -rf /var/lib/apt/lists/*\n"
        );
        let mut child = Command::new("docker")
            .args(["build", "-q", "-t", tag, "-"])
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .spawn()
            .unwrap();
        child
            .stdin
            .take()
            .unwrap()
            .write_all(dockerfile.as_bytes())
            .unwrap();
        assert!(child.wait().unwrap().success(), "build {tag}");
    }

    struct Host(String);

    impl Drop for Host {
        fn drop(&mut self) {
            docker(&["rm", "-f", &self.0]);
        }
    }

    fn start(image: &str, workload: &str) -> Host {
        let name = format!(
            "voltius-cc-{}-{}",
            std::process::id(),
            image.replace([':', '.'], "-")
        );
        docker(&["rm", "-f", &name]);
        let env = format!("W={workload}");
        let boot = r#"tmux -L t -f /dev/null new-session -d -s s -x 80 -y 24 "$W"; sleep 600"#;
        assert!(
            docker(&["run", "-d", "--name", &name, "-e", &env, image, "sh", "-c", boot])
                .status
                .success()
        );
        let host = Host(name);
        let deadline = Instant::now() + Duration::from_secs(10);
        while !docker(&["exec", &host.0, "tmux", "-L", "t", "has-session", "-t", "s"])
            .status
            .success()
        {
            assert!(Instant::now() < deadline, "tmux never came up");
            std::thread::sleep(Duration::from_millis(100));
        }
        host
    }

    fn attach(
        host: &Host,
        colors: Option<TerminalColors>,
        settle: Duration,
    ) -> (vt100::Parser, Vec<String>) {
        let mut child = Command::new("docker")
            .args([
                "exec", "-i", &host.0, "tmux", "-L", "t", "-C", "attach", "-t", "s",
            ])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .unwrap();
        let mut stdin = child.stdin.take().unwrap();
        let mut stdout = child.stdout.take().unwrap();
        let (tx, rx) = mpsc::channel::<Vec<u8>>();
        std::thread::spawn(move || {
            let mut buf = [0u8; 65536];
            while let Ok(n) = stdout.read(&mut buf) {
                if n == 0 || tx.send(buf[..n].to_vec()).is_err() {
                    break;
                }
            }
        });
        let mut session = ControlSession::new("s".into(), 80, 24, colors);
        let mut parser = vt100::Parser::new(24, 80, 100_000);
        let mut started = Vec::new();
        let mut feed = |bytes: &[u8], parser: &mut vt100::Parser, started: &mut Vec<String>| {
            for action in session.on_output(bytes) {
                match action {
                    Action::Emit(b) => parser.process(&b),
                    Action::Send(b) => stdin.write_all(&b).unwrap(),
                    Action::Started { tmux } => started.push(tmux),
                    Action::WindowChange(..) => {}
                }
            }
        };
        feed(b"\x1bP1000p", &mut parser, &mut started);
        let deadline = Instant::now() + settle;
        while Instant::now() < deadline {
            if let Ok(chunk) = rx.recv_timeout(Duration::from_millis(50)) {
                feed(&chunk, &mut parser, &mut started);
            }
        }
        let _ = child.kill();
        let _ = child.wait();
        (parser, started)
    }

    fn tmux_screen(host: &Host) -> Vec<String> {
        let out = docker(&[
            "exec",
            &host.0,
            "tmux",
            "-L",
            "t",
            "capture-pane",
            "-p",
            "-t",
            "s",
        ]);
        normalise(&String::from_utf8_lossy(&out.stdout))
    }

    fn normalise(text: &str) -> Vec<String> {
        let mut rows: Vec<String> = text.lines().map(|l| l.trim_end().to_string()).collect();
        while rows.last().is_some_and(|r| r.is_empty()) {
            rows.pop();
        }
        rows
    }

    fn all_rows(parser: &mut vt100::Parser) -> Vec<String> {
        let screen = parser.screen_mut();
        screen.set_scrollback(usize::MAX);
        let max = screen.scrollback();
        let mut rows = Vec::new();
        for offset in (1..=max).rev() {
            screen.set_scrollback(offset);
            rows.push(screen.rows(0, 80).next().unwrap_or_default());
        }
        screen.set_scrollback(0);
        rows.extend(screen.rows(0, 80));
        rows
    }

    #[test]
    #[ignore = "needs docker"]
    fn mid_burst_attach_is_gap_free_and_matches_tmux() {
        for (image, base) in IMAGES {
            ensure_image(image, base);
            let host = start(
                image,
                "i=0; while [ $i -lt 20000 ]; do i=$((i+1)); echo L$i; done; sleep 600",
            );
            std::thread::sleep(Duration::from_millis(150));
            let (mut parser, started) = attach(&host, None, Duration::from_secs(6));
            assert_eq!(started.len(), 1, "{image}: started once");
            assert_eq!(
                normalise(&parser.screen().contents()),
                tmux_screen(&host),
                "{image}: screen"
            );
            let numbers: Vec<u32> = all_rows(&mut parser)
                .iter()
                .filter_map(|r| r.trim_end().strip_prefix('L')?.parse().ok())
                .collect();
            assert!(numbers.len() > 1000, "{image}: history present");
            assert!(
                numbers.windows(2).all(|w| w[1] == w[0] + 1),
                "{image}: no gap or duplicate"
            );
            assert_eq!(*numbers.last().unwrap(), 20000, "{image}: last line");
        }
    }

    #[test]
    #[ignore = "needs docker"]
    fn fresh_session_shows_the_prompt_once() {
        for (image, base) in IMAGES {
            ensure_image(image, base);
            let host = start(image, "PS1=PROMPT; export PS1; exec sh");
            let (mut parser, _) = attach(&host, None, Duration::from_secs(2));
            let rows = all_rows(&mut parser);
            assert_eq!(
                rows.iter().filter(|r| r.contains("PROMPT")).count(),
                1,
                "{image}: {rows:?}"
            );
        }
    }

    #[test]
    #[ignore = "needs docker"]
    fn alternate_screen_app_is_rebuilt_with_its_modes() {
        let app = r"printf 'NORMAL1\nNORMAL2\n'; printf '\033[?1049h\033[3;8r\033[?1h\033=\033[?1002h\033[?1006h\033[5;3HALTSCREEN'; sleep 600";
        for (image, base) in IMAGES {
            ensure_image(image, base);
            let host = start(image, app);
            std::thread::sleep(Duration::from_millis(300));
            let (mut parser, _) = attach(&host, None, Duration::from_secs(2));
            let screen = parser.screen();
            assert!(screen.alternate_screen(), "{image}: alt screen");
            assert!(screen.application_cursor(), "{image}: DECCKM");
            assert_eq!(
                screen.mouse_protocol_mode(),
                vt100::MouseProtocolMode::ButtonMotion,
                "{image}"
            );
            assert_eq!(
                normalise(&screen.contents()),
                tmux_screen(&host),
                "{image}: alt contents"
            );
            parser.process(b"\x1b[?1049l");
            let normal = normalise(&parser.screen().contents());
            assert!(
                normal.iter().any(|r| r == "NORMAL1") && normal.iter().any(|r| r == "NORMAL2"),
                "{image}: {normal:?}"
            );
        }
    }

    #[test]
    #[ignore = "needs docker"]
    fn queries_are_answered_once_with_theme_colours() {
        let app = r"until tmux -L t show -p -t $TMUX_PANE window-style 2>/dev/null | grep -q fafa; do sleep 0.1; done; stty raw -echo; printf '\033[c\033]11;?\033\\'; ( sleep 1; kill $$ ) & cat > /tmp/r";
        let colors = TerminalColors {
            fg: "#101820".into(),
            bg: "#fafaf0".into(),
            selection_fg: "#101820".into(),
            selection_bg: "#c8d0e0".into(),
        };
        for (image, base) in IMAGES {
            ensure_image(image, base);
            let host = start(image, app);
            attach(&host, Some(colors.clone()), Duration::from_secs(6));
            let replies =
                String::from_utf8_lossy(&docker(&["exec", &host.0, "cat", "/tmp/r"]).stdout)
                    .into_owned();
            assert_eq!(
                replies.matches("\x1b[?1;2").count(),
                1,
                "{image}: one DA reply in {replies:?}"
            );
            assert!(
                replies.contains("\x1b]11;rgb:fa"),
                "{image}: theme background in {replies:?}"
            );
            assert!(
                !replies.contains("rgb:0000/0000/0000"),
                "{image}: no black default"
            );
        }
    }
}
