use serialport;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

pub struct SerialSessionManager {
    sessions: Arc<Mutex<HashMap<String, Box<dyn serialport::SerialPort>>>>,
}

impl SerialSessionManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }
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
) -> Result<(), String> {
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

    {
        let mut sessions = state.sessions.lock().unwrap();
        sessions.insert(session_id.clone(), serial);
    }

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
                    // Check if session was removed (disconnected)
                    if !sessions_arc.lock().unwrap().contains_key(&sid) {
                        break;
                    }
                    continue;
                }
                Err(_) => break,
            }
        }
        let _ = app_clone.emit(&format!("serial-closed-{}", sid), ());
    });

    let _ = app.emit(
        &format!("serial-step-{}", session_id),
        serde_json::json!({ "step": "ready", "detail": "" }),
    );

    Ok(())
}

#[tauri::command]
pub fn serial_write(
    state: tauri::State<'_, SerialSessionManager>,
    session_id: String,
    data: Vec<u8>,
) -> Result<(), String> {
    let mut sessions = state.sessions.lock().unwrap();
    let port = sessions
        .get_mut(&session_id)
        .ok_or("Serial session not found")?;
    port.write_all(&data).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn serial_disconnect(
    state: tauri::State<'_, SerialSessionManager>,
    session_id: String,
) -> Result<(), String> {
    state.sessions.lock().unwrap().remove(&session_id);
    Ok(())
}
