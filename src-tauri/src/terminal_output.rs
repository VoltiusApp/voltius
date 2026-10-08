use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, Manager};

/// Cap on startup output held for a local shell whose terminal never acknowledges
/// (a plugin driving a session headlessly); on overflow the gate opens itself.
const MAX_BUFFERED: usize = 1024 * 1024;
const MAX_BATCH: usize = 256 * 1024;
const FLUSH_WINDOW: Duration = Duration::from_millis(8);

/// Where a session's output goes: the frontend's `Channel` in the app, a
/// recorder in the tests.
pub trait OutputSink: Send + Sync {
    fn id(&self) -> u32;
    fn send(&self, body: InvokeResponseBody);
}

impl OutputSink for Channel<InvokeResponseBody> {
    fn id(&self) -> u32 {
        Channel::id(self)
    }
    fn send(&self, body: InvokeResponseBody) {
        let _ = Channel::send(self, body);
    }
}

struct State {
    sink: Option<Box<dyn OutputSink>>,
    gated: bool,
    pending: Vec<u8>,
    held_close: Option<bool>,
    flush_scheduled: bool,
    last_send: Option<Instant>,
}

/// Raw output then a JSON bool close on one channel, so the close never overtakes
/// output. Gated (local shells) until the terminal acks; bursts coalesce per window.
struct OutputStream {
    window: Duration,
    state: Mutex<State>,
}

impl OutputStream {
    fn new(gated: bool, window: Duration) -> Self {
        Self {
            window,
            state: Mutex::new(State {
                sink: None,
                gated,
                pending: Vec::new(),
                held_close: None,
                flush_scheduled: false,
                last_send: None,
            }),
        }
    }

    fn output(self: &Arc<Self>, data: &[u8]) {
        let mut state = self.state.lock().unwrap();
        if state.gated {
            state.pending.extend_from_slice(data);
            if state.pending.len() >= MAX_BUFFERED {
                Self::open(&mut state);
            }
            return;
        }
        if state.sink.is_none() {
            return;
        }
        state.pending.extend_from_slice(data);
        if state.pending.len() >= MAX_BATCH {
            Self::flush(&mut state);
            return;
        }
        if state.flush_scheduled {
            return;
        }
        let since = state.last_send.map(|t| t.elapsed());
        match since {
            Some(since) if since < self.window => {
                state.flush_scheduled = true;
                let stream = Arc::clone(self);
                let delay = self.window - since;
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(delay).await;
                    let mut state = stream.state.lock().unwrap();
                    state.flush_scheduled = false;
                    Self::flush(&mut state);
                });
            }
            _ => Self::flush(&mut state),
        }
    }

    fn closed(&self, clean_exit: bool) {
        let mut state = self.state.lock().unwrap();
        if state.gated {
            state.held_close = Some(clean_exit);
            return;
        }
        Self::finish(&mut state, clean_exit);
    }

    fn release(&self) {
        Self::open(&mut self.state.lock().unwrap());
    }

    fn attach(&self, sink: Box<dyn OutputSink>) {
        let mut state = self.state.lock().unwrap();
        state.sink = Some(sink);
        state.last_send = None;
    }

    fn detach(&self, sink_id: u32) -> bool {
        let mut state = self.state.lock().unwrap();
        if state.sink.as_ref().map(|s| s.id()) != Some(sink_id) {
            return false;
        }
        state.sink = None;
        state.pending.clear();
        true
    }

    fn open(state: &mut State) {
        if !state.gated {
            return;
        }
        state.gated = false;
        match state.held_close.take() {
            Some(clean_exit) => Self::finish(state, clean_exit),
            None => Self::flush(state),
        }
    }

    fn finish(state: &mut State, clean_exit: bool) {
        Self::flush(state);
        if let Some(sink) = &state.sink {
            sink.send(InvokeResponseBody::Json(clean_exit.to_string()));
        }
    }

    fn flush(state: &mut State) {
        if state.pending.is_empty() {
            return;
        }
        let data = std::mem::take(&mut state.pending);
        if let Some(sink) = &state.sink {
            sink.send(InvokeResponseBody::Raw(data));
            state.last_send = Some(Instant::now());
        }
    }
}

/// Output streams by session id. Entries outlive a transport (an SSH reconnect
/// reuses its id) and go when the frontend detaches or the local shell is closed.
pub struct TerminalOutputs {
    window: Duration,
    streams: Mutex<HashMap<String, Arc<OutputStream>>>,
}

impl Default for TerminalOutputs {
    fn default() -> Self {
        Self::with_window(FLUSH_WINDOW)
    }
}

impl TerminalOutputs {
    fn with_window(window: Duration) -> Self {
        Self {
            window,
            streams: Mutex::new(HashMap::new()),
        }
    }

    fn entry(&self, session_id: &str, gated: bool) -> Arc<OutputStream> {
        let mut streams = self.streams.lock().unwrap();
        Arc::clone(
            streams
                .entry(session_id.to_string())
                .or_insert_with(|| Arc::new(OutputStream::new(gated, self.window))),
        )
    }

    fn get(&self, session_id: &str) -> Option<Arc<OutputStream>> {
        self.streams.lock().unwrap().get(session_id).cloned()
    }

    /// A local shell is starting: hold its output until `release`.
    pub fn gate(&self, session_id: &str) {
        self.entry(session_id, true);
    }

    pub fn release(&self, session_id: &str) {
        self.entry(session_id, true).release();
    }

    pub fn attach(&self, session_id: &str, gated: bool, sink: Box<dyn OutputSink>) {
        self.entry(session_id, gated).attach(sink);
    }

    /// Ignored unless `sink_id` is still the attached sink, so a detach that
    /// lands after a re-attach cannot cut the new subscriber off.
    pub fn detach(&self, session_id: &str, sink_id: u32) {
        let mut streams = self.streams.lock().unwrap();
        if streams.get(session_id).is_some_and(|s| s.detach(sink_id)) {
            streams.remove(session_id);
        }
    }

    pub fn remove(&self, session_id: &str) {
        self.streams.lock().unwrap().remove(session_id);
    }

    pub fn output(&self, session_id: &str, data: &[u8]) {
        if let Some(stream) = self.get(session_id) {
            stream.output(data);
        }
    }

    pub fn closed(&self, session_id: &str, clean_exit: bool) {
        if let Some(stream) = self.get(session_id) {
            stream.closed(clean_exit);
        }
    }
}

pub fn emit_output(app: &AppHandle, session_id: &str, data: &[u8]) {
    app.state::<TerminalOutputs>().output(session_id, data);
}

pub fn emit_closed(app: &AppHandle, session_id: &str, clean_exit: bool) {
    app.state::<TerminalOutputs>()
        .closed(session_id, clean_exit);
}

#[tauri::command]
pub fn terminal_output_attach(
    outputs: tauri::State<'_, TerminalOutputs>,
    session_id: String,
    gated: bool,
    channel: Channel<InvokeResponseBody>,
) {
    outputs.attach(&session_id, gated, Box::new(channel));
}

#[tauri::command]
pub fn terminal_output_detach(
    outputs: tauri::State<'_, TerminalOutputs>,
    session_id: String,
    channel_id: u32,
) {
    outputs.detach(&session_id, channel_id);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Debug, PartialEq)]
    enum Msg {
        Bytes(Vec<u8>),
        Closed(bool),
    }

    #[derive(Clone, Default)]
    struct Recorder(Arc<Mutex<Vec<Msg>>>, u32);

    impl Recorder {
        fn with_id(id: u32) -> Self {
            Self(Arc::default(), id)
        }
        fn take(&self) -> Vec<Msg> {
            std::mem::take(&mut *self.0.lock().unwrap())
        }
    }

    impl OutputSink for Recorder {
        fn id(&self) -> u32 {
            self.1
        }
        fn send(&self, body: InvokeResponseBody) {
            let msg = match body {
                InvokeResponseBody::Raw(data) => Msg::Bytes(data),
                InvokeResponseBody::Json(json) => Msg::Closed(json.parse().unwrap()),
            };
            self.0.lock().unwrap().push(msg);
        }
    }

    const SLOW: Duration = Duration::from_secs(3600);

    fn attached(outputs: &TerminalOutputs, gated: bool) -> Recorder {
        let sink = Recorder::default();
        outputs.attach("s", gated, Box::new(sink.clone()));
        sink
    }

    #[test]
    fn a_gated_stream_holds_output_until_released_then_replays_it() {
        let outputs = TerminalOutputs::with_window(SLOW);
        outputs.gate("s");
        outputs.output("s", b"Microsoft Windows [Version");
        let sink = attached(&outputs, true);
        outputs.output("s", b" 10.0]\r\nC:\\>");
        assert_eq!(sink.take(), vec![], "nothing before the terminal acks");

        outputs.release("s");
        assert_eq!(
            sink.take(),
            vec![Msg::Bytes(
                b"Microsoft Windows [Version 10.0]\r\nC:\\>".to_vec()
            )],
        );
    }

    #[test]
    fn a_close_during_the_gate_lands_after_the_replayed_output() {
        let outputs = TerminalOutputs::with_window(SLOW);
        let sink = attached(&outputs, true);
        outputs.output("s", b"'sh' is not recognized\r\n");
        outputs.closed("s", false);
        assert_eq!(sink.take(), vec![]);

        outputs.release("s");
        assert_eq!(
            sink.take(),
            vec![
                Msg::Bytes(b"'sh' is not recognized\r\n".to_vec()),
                Msg::Closed(false),
            ],
        );
    }

    #[test]
    fn attaching_a_local_shell_before_its_spawn_still_gates_it() {
        let outputs = TerminalOutputs::with_window(SLOW);
        let sink = attached(&outputs, true);
        outputs.gate("s");
        outputs.output("s", b"banner");
        assert_eq!(sink.take(), vec![]);
        outputs.release("s");
        assert_eq!(sink.take(), vec![Msg::Bytes(b"banner".to_vec())]);
    }

    #[test]
    fn a_release_before_the_spawn_leaves_the_stream_live() {
        let outputs = TerminalOutputs::with_window(SLOW);
        let sink = attached(&outputs, true);
        outputs.release("s");
        outputs.gate("s");
        outputs.output("s", b"ls\r\n");
        outputs.closed("s", true);
        assert_eq!(
            sink.take(),
            vec![Msg::Bytes(b"ls\r\n".to_vec()), Msg::Closed(true)],
        );
    }

    #[test]
    fn the_gate_opens_itself_when_the_buffer_fills() {
        let outputs = TerminalOutputs::with_window(SLOW);
        let sink = attached(&outputs, true);
        outputs.output("s", &vec![b'x'; MAX_BUFFERED]);
        assert_eq!(sink.take(), vec![Msg::Bytes(vec![b'x'; MAX_BUFFERED])]);
    }

    #[test]
    fn release_is_idempotent() {
        let outputs = TerminalOutputs::with_window(SLOW);
        let sink = attached(&outputs, true);
        outputs.output("s", b"prompt> ");
        outputs.release("s");
        sink.take();
        outputs.release("s");
        assert_eq!(sink.take(), vec![], "no second replay");
    }

    #[test]
    fn output_for_a_session_nobody_attached_is_dropped() {
        let outputs = TerminalOutputs::with_window(SLOW);
        outputs.output("s", b"lost");
        let sink = attached(&outputs, false);
        outputs.closed("s", true);
        assert_eq!(sink.take(), vec![Msg::Closed(true)]);
    }

    #[test]
    fn a_burst_is_coalesced_and_flushed_before_the_close() {
        let outputs = TerminalOutputs::with_window(SLOW);
        let sink = attached(&outputs, false);
        outputs.output("s", b"a");
        outputs.output("s", b"b");
        outputs.output("s", b"c");
        assert_eq!(
            sink.take(),
            vec![Msg::Bytes(b"a".to_vec())],
            "first chunk goes at once"
        );

        outputs.closed("s", true);
        assert_eq!(
            sink.take(),
            vec![Msg::Bytes(b"bc".to_vec()), Msg::Closed(true)],
        );
    }

    #[test]
    fn a_full_batch_is_sent_without_waiting_for_the_window() {
        let outputs = TerminalOutputs::with_window(SLOW);
        let sink = attached(&outputs, false);
        outputs.output("s", b"a");
        outputs.output("s", &vec![b'x'; MAX_BATCH]);
        assert_eq!(
            sink.take(),
            vec![Msg::Bytes(b"a".to_vec()), Msg::Bytes(vec![b'x'; MAX_BATCH])],
        );
    }

    #[test]
    fn the_rest_of_a_burst_is_flushed_when_the_window_ends() {
        let outputs = TerminalOutputs::with_window(Duration::from_millis(20));
        let sink = attached(&outputs, false);
        outputs.output("s", b"a");
        outputs.output("s", b"b");
        std::thread::sleep(Duration::from_millis(500));
        assert_eq!(
            sink.take(),
            vec![Msg::Bytes(b"a".to_vec()), Msg::Bytes(b"b".to_vec())],
        );
    }

    #[test]
    fn a_stale_detach_keeps_the_newer_subscriber() {
        let outputs = TerminalOutputs::with_window(SLOW);
        outputs.attach("s", false, Box::new(Recorder::with_id(1)));
        let newer = Recorder::with_id(2);
        outputs.attach("s", false, Box::new(newer.clone()));
        outputs.detach("s", 1);
        outputs.output("s", b"still here");
        assert_eq!(newer.take(), vec![Msg::Bytes(b"still here".to_vec())]);

        outputs.detach("s", 2);
        assert!(outputs.get("s").is_none());
    }
}
