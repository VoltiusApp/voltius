const MARKER: &[u8] = b"\x1bP1000p";
const MARKER_WINDOW: usize = 64 * 1024;

#[derive(Debug, PartialEq)]
pub enum Event {
    Passthrough(Vec<u8>),
    Output { pane: String, data: Vec<u8> },
    Reply { ok: bool, lines: Vec<Vec<u8>> },
}

struct Block {
    number: Vec<u8>,
    ours: bool,
    lines: Vec<Vec<u8>>,
}

#[derive(Default)]
pub struct Demux {
    control: bool,
    exited: bool,
    scanned: usize,
    buf: Vec<u8>,
    block: Option<Block>,
}

impl Demux {
    pub fn is_control(&self) -> bool {
        self.control
    }

    pub fn feed(&mut self, bytes: &[u8]) -> Vec<Event> {
        let mut events = Vec::new();
        if self.exited {
            return events;
        }
        if !self.control {
            if self.scanned >= MARKER_WINDOW {
                events.push(Event::Passthrough(bytes.to_vec()));
                return events;
            }
            self.buf.extend_from_slice(bytes);
            match self.buf.windows(MARKER.len()).position(|w| w == MARKER) {
                Some(at) => {
                    if at > 0 {
                        events.push(Event::Passthrough(self.buf[..at].to_vec()));
                    }
                    self.buf.drain(..at + MARKER.len());
                    self.control = true;
                }
                None => {
                    let held = (1..MARKER.len())
                        .rev()
                        .find(|&k| self.buf.ends_with(&MARKER[..k]))
                        .unwrap_or(0);
                    let ready = self.buf.len() - held;
                    self.scanned += ready;
                    if ready > 0 {
                        events.push(Event::Passthrough(self.buf.drain(..ready).collect()));
                    }
                    return events;
                }
            }
        } else {
            self.buf.extend_from_slice(bytes);
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
            if self.exited {
                self.buf.clear();
                break;
            }
        }
        events
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
            self.exited = true;
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
        assert_eq!(d.feed(b"ab\x1bP10"), vec![Event::Passthrough(b"ab".to_vec())]);
        assert!(!d.is_control());
        assert_eq!(d.feed(b"00p%output %0 x\r\n"), vec![out("%0", b"x")]);
        assert!(d.is_control());
    }

    #[test]
    fn held_escape_is_released_when_it_is_not_the_marker() {
        let mut d = Demux::default();
        assert_eq!(d.feed(b"abc\x1b"), vec![Event::Passthrough(b"abc".to_vec())]);
        assert_eq!(d.feed(b"[m"), vec![Event::Passthrough(b"\x1b[m".to_vec())]);
        assert!(!d.is_control());
    }

    #[test]
    fn marker_is_only_recognised_near_the_start() {
        let mut d = Demux::default();
        let filler = vec![b'x'; MARKER_WINDOW + 10];
        d.feed(&filler);
        let events = d.feed(b"\x1bP1000p%exit\r\n");
        assert_eq!(
            events,
            vec![Event::Passthrough(b"\x1bP1000p%exit\r\n".to_vec())]
        );
        assert!(!d.is_control());
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
}
