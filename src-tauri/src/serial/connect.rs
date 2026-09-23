use serialport;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

pub(super) struct SerialSession {
    generation: u64,
    port: Box<dyn serialport::SerialPort>,
    pub(super) lines: SerialLines,
}

const BREAK_DURATION: Duration = Duration::from_millis(250);

#[derive(serde::Serialize, Clone, Copy, Debug, PartialEq, Eq)]
pub struct SerialLines {
    pub dtr: bool,
    pub rts: bool,
}

impl SerialLines {
    // The crate cannot read output lines back. A POSIX tty raises both on open; the
    // Windows backend clears DTR and raises RTS only for hardware flow control.
    pub(super) fn on_open(windows: bool, flow_control: serialport::FlowControl) -> Self {
        if windows {
            Self {
                dtr: false,
                rts: flow_control == serialport::FlowControl::Hardware,
            }
        } else {
            Self {
                dtr: true,
                rts: true,
            }
        }
    }
}

#[derive(serde::Deserialize, Clone, Copy, Debug)]
#[serde(rename_all = "lowercase")]
pub enum SerialLine {
    Dtr,
    Rts,
}

pub(super) type SessionMap = HashMap<String, SerialSession>;

pub struct SerialSessionManager {
    pub(super) sessions: Arc<Mutex<SessionMap>>,
    next_generation: AtomicU64,
}

impl SerialSessionManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            next_generation: AtomicU64::new(1),
        }
    }

    /// Registers a freshly opened port under `session_id`, replacing whatever
    /// was there, and hands back the generation identifying this open.
    pub(super) fn insert(
        &self,
        session_id: &str,
        port: Box<dyn serialport::SerialPort>,
        lines: SerialLines,
    ) -> u64 {
        let generation = self.next_generation.fetch_add(1, Ordering::Relaxed);
        self.sessions.lock().unwrap().insert(
            session_id.to_string(),
            SerialSession {
                generation,
                port,
                lines,
            },
        );
        generation
    }

    pub(super) fn remove(&self, session_id: &str) {
        self.sessions.lock().unwrap().remove(session_id);
    }
}

pub(super) fn with_session<T>(
    sessions: &Mutex<SessionMap>,
    session_id: &str,
    f: impl FnOnce(&mut SerialSession) -> Result<T, String>,
) -> Result<T, String> {
    let mut sessions = sessions.lock().unwrap();
    let session = sessions
        .get_mut(session_id)
        .ok_or("Serial session not found")?;
    f(session)
}

pub(super) fn set_line(
    sessions: &Mutex<SessionMap>,
    session_id: &str,
    line: SerialLine,
    level: bool,
) -> Result<SerialLines, String> {
    with_session(sessions, session_id, |session| {
        let SerialSession { port, lines, .. } = session;
        let (written, slot) = match line {
            SerialLine::Dtr => (port.write_data_terminal_ready(level), &mut lines.dtr),
            SerialLine::Rts => (port.write_request_to_send(level), &mut lines.rts),
        };
        written.map_err(|e| e.to_string())?;
        *slot = level;
        Ok(*lines)
    })
}

// Holds the map lock for the whole break so no write can interleave with it.
pub(super) fn send_break(
    sessions: &Mutex<SessionMap>,
    session_id: &str,
    duration: Duration,
) -> Result<(), String> {
    with_session(sessions, session_id, |session| {
        session.port.set_break().map_err(|e| e.to_string())?;
        thread::sleep(duration);
        session.port.clear_break().map_err(|e| e.to_string())
    })
}

/// Whether `generation` still owns `session_id`.
///
/// A read thread keeps its own cloned descriptor, so closing and reopening the
/// port leaves the previous thread running. Without this check both threads read
/// the same device and split its output between them, and the older one's
/// `serial-closed` would tear down the session that replaced it.
pub(super) fn generation_is_current(
    sessions: &Mutex<SessionMap>,
    session_id: &str,
    generation: u64,
) -> bool {
    sessions
        .lock()
        .unwrap()
        .get(session_id)
        .is_some_and(|s| s.generation == generation)
}

#[derive(serde::Serialize, Clone)]
pub struct SerialPortInfo {
    pub name: String,
    pub path: String,
}

#[tauri::command]
pub fn serial_list_ports() -> Result<Vec<SerialPortInfo>, String> {
    let mut ports: Vec<SerialPortInfo> = Vec::new();

    if let Ok(detected) = serialport::available_ports() {
        for p in detected {
            ports.push(SerialPortInfo {
                name: p.port_name.clone(),
                path: p.port_name,
            });
        }
    }

    // On Linux, libudev is disabled so available_ports() returns nothing.
    // Scan /dev for device nodes that only appear when hardware is attached.
    #[cfg(target_os = "linux")]
    {
        use std::fs;
        let prefixes = ["ttyUSB", "ttyACM", "ttyAMA", "rfcomm"];
        let existing: std::collections::HashSet<String> =
            ports.iter().map(|p| p.path.clone()).collect();
        if let Ok(entries) = fs::read_dir("/dev") {
            let mut extra: Vec<SerialPortInfo> = entries
                .flatten()
                .filter_map(|e| {
                    let file_name = e.file_name().to_string_lossy().to_string();
                    if prefixes.iter().any(|pfx| file_name.starts_with(pfx)) {
                        let path = format!("/dev/{}", file_name);
                        (!existing.contains(&path)).then_some(SerialPortInfo {
                            name: file_name,
                            path,
                        })
                    } else {
                        None
                    }
                })
                .collect();
            extra.sort_by(|a, b| a.path.cmp(&b.path));
            ports.extend(extra);
        }
    }

    Ok(ports)
}

#[tauri::command]
pub fn serial_connect(
    app: AppHandle,
    state: tauri::State<'_, SerialSessionManager>,
    session_id: String,
    port: String,
    baud: u32,
    data_bits: Option<u8>,
    parity: Option<String>,
    stop_bits: Option<u8>,
    flow_control: Option<String>,
) -> Result<SerialLines, String> {
    let _ = app.emit(
        &format!("serial-step-{}", session_id),
        serde_json::json!({ "step": "open_port", "detail": "" }),
    );

    let data_bits_val = match data_bits.unwrap_or(8) {
        5 => serialport::DataBits::Five,
        6 => serialport::DataBits::Six,
        7 => serialport::DataBits::Seven,
        _ => serialport::DataBits::Eight,
    };
    let parity_val = match parity.as_deref().unwrap_or("none") {
        "even" => serialport::Parity::Even,
        "odd" => serialport::Parity::Odd,
        _ => serialport::Parity::None,
    };
    let stop_bits_val = match stop_bits.unwrap_or(1) {
        2 => serialport::StopBits::Two,
        _ => serialport::StopBits::One,
    };
    let flow_control_val = match flow_control.as_deref().unwrap_or("none") {
        "xon-xoff" => serialport::FlowControl::Software,
        "rts-cts" => serialport::FlowControl::Hardware,
        _ => serialport::FlowControl::None,
    };

    let serial = serialport::new(&port, baud)
        .data_bits(data_bits_val)
        .parity(parity_val)
        .stop_bits(stop_bits_val)
        .flow_control(flow_control_val)
        .timeout(Duration::from_millis(10))
        .open()
        .map_err(|e| e.to_string())?;

    let read_port = serial.try_clone().map_err(|e| e.to_string())?;
    let lines = SerialLines::on_open(cfg!(windows), flow_control_val);
    let generation = state.insert(&session_id, serial, lines);

    // Spawn read loop thread
    let app_clone = app.clone();
    let sid = session_id.clone();
    let sessions_arc = Arc::clone(&state.sessions);
    thread::spawn(move || {
        let mut port = read_port;
        let mut buf = [0u8; 1024];
        loop {
            match port.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let data: Vec<u8> = buf[..n].to_vec();
                    let _ = app_clone.emit(&format!("serial-output-{}", sid), data);
                }
                Err(ref e) if e.kind() == std::io::ErrorKind::TimedOut => {
                    // Bail once this open is no longer the session's: it was
                    // disconnected, or reopened by a newer generation.
                    if !generation_is_current(&sessions_arc, &sid, generation) {
                        break;
                    }
                    continue;
                }
                Err(_) => break,
            }
        }
        if generation_is_current(&sessions_arc, &sid, generation) {
            let _ = app_clone.emit(&format!("serial-closed-{}", sid), ());
        }
    });

    let _ = app.emit(
        &format!("serial-step-{}", session_id),
        serde_json::json!({ "step": "ready", "detail": "" }),
    );

    Ok(lines)
}

#[tauri::command]
pub fn serial_write(
    state: tauri::State<'_, SerialSessionManager>,
    session_id: String,
    data: Vec<u8>,
) -> Result<(), String> {
    with_session(&state.sessions, &session_id, |session| {
        session.port.write_all(&data).map_err(|e| e.to_string())
    })
}

#[tauri::command]
pub fn serial_set_line(
    state: tauri::State<'_, SerialSessionManager>,
    session_id: String,
    line: SerialLine,
    level: bool,
) -> Result<SerialLines, String> {
    set_line(&state.sessions, &session_id, line, level)
}

#[tauri::command]
pub async fn serial_send_break(
    state: tauri::State<'_, SerialSessionManager>,
    session_id: String,
) -> Result<(), String> {
    let sessions = Arc::clone(&state.sessions);
    tauri::async_runtime::spawn_blocking(move || send_break(&sessions, &session_id, BREAK_DURATION))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn serial_disconnect(
    state: tauri::State<'_, SerialSessionManager>,
    session_id: String,
) -> Result<(), String> {
    state.remove(&session_id);
    Ok(())
}
