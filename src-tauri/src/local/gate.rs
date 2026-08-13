// Startup-output gate.
//
// A PTY starts writing its banner and first prompt within microseconds of the
// spawn, while the frontend's `listen()` for `local-output-<id>` is still an
// unacknowledged IPC roundtrip. Tauri drops an `emit` nobody is registered for
// yet, so those first bytes were lost and the terminal came up blank with a
// live shell behind it. SSH never hit this only because its connect takes long
// enough for the listener to always win.
//
// The gate buffers output (and a close that arrives during the buffering
// window) until the frontend acknowledges its listener, then replays in order
// and goes live.

use std::sync::Mutex;
use tauri::{AppHandle, Emitter};

/// Cap on buffered startup output. A consumer that never acknowledges (a
/// plugin driving a session headlessly) must not grow this without bound; on
/// overflow the gate opens itself, which is exactly the pre-gate behaviour.
const MAX_BUFFERED: usize = 1024 * 1024;

/// Where the gate's events go. Implemented by `AppHandle` in the app and by a
/// recording sink in the tests, which have no Tauri runtime to emit into.
pub trait EventSink {
    fn emit_bytes(&self, event: &str, data: &[u8]);
    fn emit_unit(&self, event: &str);
}

impl EventSink for AppHandle {
    fn emit_bytes(&self, event: &str, data: &[u8]) {
        let _ = self.emit(event, data);
    }
    fn emit_unit(&self, event: &str) {
        let _ = self.emit(event, ());
    }
}

enum State {
    Buffering { output: Vec<u8>, closed: bool },
    Live,
}

pub struct OutputGate {
    output_event: String,
    close_event: String,
    state: Mutex<State>,
}

impl OutputGate {
    pub fn new(output_event: String, close_event: String) -> Self {
        Self {
            output_event,
            close_event,
            state: Mutex::new(State::Buffering {
                output: Vec::new(),
                closed: false,
            }),
        }
    }

    /// PTY output — emitted live, or held for the replay.
    pub fn output(&self, sink: &impl EventSink, data: &[u8]) {
        let mut state = self.state.lock().unwrap();
        match &mut *state {
            State::Live => sink.emit_bytes(&self.output_event, data),
            State::Buffering { output, .. } => {
                output.extend_from_slice(data);
                if output.len() >= MAX_BUFFERED {
                    self.open(sink, &mut state);
                }
            }
        }
    }

    /// The shell exited. Held behind any buffered output so the replay stays
    /// ordered — a shell that dies instantly must not close the terminal
    /// before its error text has been written.
    pub fn closed(&self, sink: &impl EventSink) {
        let mut state = self.state.lock().unwrap();
        match &mut *state {
            State::Live => sink.emit_unit(&self.close_event),
            State::Buffering { closed, .. } => *closed = true,
        }
    }

    /// The frontend's listeners are registered: replay and go live.
    pub fn release(&self, sink: &impl EventSink) {
        let mut state = self.state.lock().unwrap();
        self.open(sink, &mut state);
    }

    fn open(&self, sink: &impl EventSink, state: &mut State) {
        let previous = std::mem::replace(state, State::Live);
        if let State::Buffering { output, closed } = previous {
            if !output.is_empty() {
                sink.emit_bytes(&self.output_event, &output);
            }
            if closed {
                sink.emit_unit(&self.close_event);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Debug, PartialEq)]
    enum Event {
        Bytes(String, Vec<u8>),
        Unit(String),
    }

    #[derive(Default)]
    struct Recorder(Mutex<Vec<Event>>);

    impl Recorder {
        fn events(&self) -> Vec<Event> {
            std::mem::take(&mut *self.0.lock().unwrap())
        }
    }

    impl EventSink for Recorder {
        fn emit_bytes(&self, event: &str, data: &[u8]) {
            self.0
                .lock()
                .unwrap()
                .push(Event::Bytes(event.to_string(), data.to_vec()));
        }
        fn emit_unit(&self, event: &str) {
            self.0.lock().unwrap().push(Event::Unit(event.to_string()));
        }
    }

    fn gate() -> OutputGate {
        OutputGate::new("out".into(), "closed".into())
    }

    #[test]
    fn holds_output_until_released_then_replays_it() {
        let sink = Recorder::default();
        let gate = gate();

        gate.output(&sink, b"Microsoft Windows [Version");
        gate.output(&sink, b" 10.0]\r\nC:\\>");
        assert_eq!(sink.events(), vec![], "nothing before the listener acks");

        gate.release(&sink);
        assert_eq!(
            sink.events(),
            vec![Event::Bytes(
                "out".into(),
                b"Microsoft Windows [Version 10.0]\r\nC:\\>".to_vec()
            )],
        );
    }

    #[test]
    fn goes_live_after_release() {
        let sink = Recorder::default();
        let gate = gate();

        gate.release(&sink);
        assert_eq!(sink.events(), vec![], "nothing buffered, nothing replayed");

        gate.output(&sink, b"ls\r\n");
        gate.closed(&sink);
        assert_eq!(
            sink.events(),
            vec![
                Event::Bytes("out".into(), b"ls\r\n".to_vec()),
                Event::Unit("closed".into()),
            ],
        );
    }

    #[test]
    fn a_close_during_the_window_lands_after_the_replayed_output() {
        let sink = Recorder::default();
        let gate = gate();

        gate.output(&sink, b"'sh' is not recognized\r\n");
        gate.closed(&sink);
        assert_eq!(sink.events(), vec![]);

        gate.release(&sink);
        assert_eq!(
            sink.events(),
            vec![
                Event::Bytes("out".into(), b"'sh' is not recognized\r\n".to_vec()),
                Event::Unit("closed".into()),
            ],
        );
    }

    #[test]
    fn opens_itself_when_the_buffer_fills() {
        let sink = Recorder::default();
        let gate = gate();

        gate.output(&sink, &vec![b'x'; MAX_BUFFERED]);
        assert_eq!(
            sink.events(),
            vec![Event::Bytes("out".into(), vec![b'x'; MAX_BUFFERED])],
            "overflow flushes instead of growing without bound",
        );

        gate.output(&sink, b"live");
        assert_eq!(
            sink.events(),
            vec![Event::Bytes("out".into(), b"live".to_vec())],
        );
    }

    #[test]
    fn release_is_idempotent() {
        let sink = Recorder::default();
        let gate = gate();

        gate.output(&sink, b"prompt> ");
        gate.release(&sink);
        sink.events();

        gate.release(&sink);
        assert_eq!(sink.events(), vec![], "no second replay");
    }
}
