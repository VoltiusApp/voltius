use std::ffi::OsString;
use std::io::{IoSlice, IoSliceMut};
use std::os::windows::io::{AsRawHandle, RawHandle, OwnedHandle, FromRawHandle};
use std::path::{Path, PathBuf};
use std::time::Duration;

use windows_sys::Win32::Devices::Communication::CLRDTR;
use windows_sys::Win32::Devices::Communication::CLRRTS;
use windows_sys::Win32::Devices::Communication::COMMTIMEOUTS;
use windows_sys::Win32::Devices::Communication::ClearCommBreak;
use windows_sys::Win32::Devices::Communication::DCB;
use windows_sys::Win32::Devices::Communication::EVENPARITY;
use windows_sys::Win32::Devices::Communication::EscapeCommFunction;
use windows_sys::Win32::Devices::Communication::GetCommModemStatus;
use windows_sys::Win32::Devices::Communication::GetCommState;
use windows_sys::Win32::Devices::Communication::GetCommTimeouts;
use windows_sys::Win32::Devices::Communication::MS_CTS_ON;
use windows_sys::Win32::Devices::Communication::MS_DSR_ON;
use windows_sys::Win32::Devices::Communication::MS_RING_ON;
use windows_sys::Win32::Devices::Communication::MS_RLSD_ON;
use windows_sys::Win32::Devices::Communication::NOPARITY;
use windows_sys::Win32::Devices::Communication::ODDPARITY;
use windows_sys::Win32::Devices::Communication::ONESTOPBIT;
use windows_sys::Win32::Devices::Communication::PURGE_RXCLEAR;
use windows_sys::Win32::Devices::Communication::PURGE_TXCLEAR;
use windows_sys::Win32::Devices::Communication::PurgeComm;
use windows_sys::Win32::Devices::Communication::SETDTR;
use windows_sys::Win32::Devices::Communication::SETRTS;
use windows_sys::Win32::Devices::Communication::SetCommBreak;
use windows_sys::Win32::Devices::Communication::SetCommState;
use windows_sys::Win32::Devices::Communication::SetCommTimeouts;
use windows_sys::Win32::Devices::Communication::TWOSTOPBITS;
use windows_sys::Win32::Foundation::ERROR_IO_PENDING;
use windows_sys::Win32::Foundation::ERROR_NO_MORE_ITEMS;
use windows_sys::Win32::Storage::FileSystem::FILE_FLAG_OVERLAPPED;
use windows_sys::Win32::Storage::FileSystem::FlushFileBuffers;
use windows_sys::Win32::Storage::FileSystem::ReadFile;
use windows_sys::Win32::Storage::FileSystem::WriteFile;
use windows_sys::Win32::System::IO::GetOverlappedResult;
use windows_sys::Win32::System::IO::OVERLAPPED;
use windows_sys::Win32::System::Registry::HKEY;
use windows_sys::Win32::System::Registry::HKEY_LOCAL_MACHINE;
use windows_sys::Win32::System::Registry::KEY_READ;
use windows_sys::Win32::System::Registry::REG_SAM_FLAGS;
use windows_sys::Win32::System::Registry::REG_SZ;
use windows_sys::Win32::System::Registry::RegCloseKey;
use windows_sys::Win32::System::Registry::RegEnumValueA;
use windows_sys::Win32::System::Registry::RegOpenKeyExA;
use windows_sys::Win32::System::Registry::RegQueryInfoKeyA;
use windows_sys::Win32::System::Threading::CreateEventA;
use windows_sys::Win32::System::WindowsProgramming::DTR_CONTROL_DISABLE;
use windows_sys::Win32::System::WindowsProgramming::RTS_CONTROL_DISABLE;
use windows_sys::Win32::System::WindowsProgramming::RTS_CONTROL_TOGGLE;
use windows_sys::core::BOOL;
use windows_sys::core::PCSTR;

pub struct SerialPort {
	pub file: std::fs::File,
}

impl std::fmt::Debug for SerialPort {
	fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
		f.debug_struct("SerialPort")
			.field("handle", &self.file.as_raw_handle())
			.finish()
	}
}

#[derive(Clone)]
pub struct Settings {
	pub dcb: DCB,
}

impl SerialPort {
	pub fn open(name: &Path) -> std::io::Result<Self> {
		use std::os::windows::fs::OpenOptionsExt;

		// Use the win32 device namespace, otherwise we're limited to COM1-9.
		// This also works with higher numbers.
		// https://docs.microsoft.com/en-us/windows/win32/fileio/naming-a-file#win32-device-namespaces
		let mut path = OsString::from("\\\\.\\");
		path.push(name.as_os_str());

		let file = std::fs::OpenOptions::new()
			.read(true)
			.write(true)
			.create(false)
			.custom_flags(FILE_FLAG_OVERLAPPED)
			.open(path)?;

		unsafe {
			let mut timeouts: COMMTIMEOUTS = std::mem::zeroed();
			check_bool(GetCommTimeouts(file.as_raw_handle(), &mut timeouts))?;
			// Mimic POSIX behaviour for reads.
			// For more details, see:
			// https://learn.microsoft.com/en-us/windows/win32/api/winbase/ns-winbase-commtimeouts#remarks
			timeouts.ReadIntervalTimeout = u32::MAX;
			timeouts.ReadTotalTimeoutMultiplier = u32::MAX;
			timeouts.ReadTotalTimeoutConstant = super::DEFAULT_TIMEOUT_MS;
			timeouts.WriteTotalTimeoutMultiplier = 0;
			timeouts.WriteTotalTimeoutConstant = super::DEFAULT_TIMEOUT_MS;
			check_bool(SetCommTimeouts(file.as_raw_handle(), &timeouts))?;
		}
		Ok(Self::from_file(file))
	}

	pub fn from_file(file: std::fs::File) -> Self {
		Self { file }
	}

	pub fn try_clone(&self) -> std::io::Result<Self> {
		Ok(Self {
			file: self.file.try_clone()?,
		})
	}

	pub fn get_configuration(&self) -> std::io::Result<Settings> {
		unsafe {
			let mut dcb: DCB = std::mem::zeroed();
			check_bool(GetCommState(self.file.as_raw_handle(), &mut dcb))?;
			Ok(Settings { dcb })
		}
	}

	pub fn set_configuration(&mut self, settings: &Settings) -> std::io::Result<()> {
		unsafe {
			let settings = settings.clone();
			check_bool(SetCommState(self.file.as_raw_handle(), &settings.dcb))
		}
	}

	pub fn set_read_timeout(&mut self, timeout: Duration) -> std::io::Result<()> {
		unsafe {
			let mut timeouts = std::mem::zeroed();
			// Mimic POSIX behaviour for reads.
			// Timeout must be > 0 and < u32::MAX, so clamp it.
			// For more details, see:
			// https://learn.microsoft.com/en-us/windows/win32/api/winbase/ns-winbase-commtimeouts#remarks
			let timeout_ms = timeout
				.as_millis()
				.try_into()
				.unwrap_or(u32::MAX)
				.clamp(1, u32::MAX - 1);
			check_bool(GetCommTimeouts(self.file.as_raw_handle(), &mut timeouts))?;
			timeouts.ReadIntervalTimeout = u32::MAX;
			timeouts.ReadTotalTimeoutMultiplier = u32::MAX;
			timeouts.ReadTotalTimeoutConstant = timeout_ms;
			check_bool(SetCommTimeouts(self.file.as_raw_handle(), &timeouts))
		}
	}

	pub fn get_read_timeout(&self) -> std::io::Result<Duration> {
		unsafe {
			let mut timeouts = std::mem::zeroed();
			check_bool(GetCommTimeouts(self.file.as_raw_handle(), &mut timeouts))?;
			Ok(Duration::from_millis(timeouts.ReadTotalTimeoutConstant.into()))
		}
	}

	pub fn set_write_timeout(&mut self, timeout: Duration) -> std::io::Result<()> {
		unsafe {
			let mut timeouts = std::mem::zeroed();
			let timeout_ms = timeout.as_millis().try_into().unwrap_or(u32::MAX);
			check_bool(GetCommTimeouts(self.file.as_raw_handle(), &mut timeouts))?;
			timeouts.WriteTotalTimeoutMultiplier = 0;
			timeouts.WriteTotalTimeoutConstant = timeout_ms;
			check_bool(SetCommTimeouts(self.file.as_raw_handle(), &timeouts))
		}
	}

	pub fn get_write_timeout(&self) -> std::io::Result<Duration> {
		unsafe {
			let mut timeouts = std::mem::zeroed();
			check_bool(GetCommTimeouts(self.file.as_raw_handle(), &mut timeouts))?;
			Ok(Duration::from_millis(timeouts.WriteTotalTimeoutConstant.into()))
		}
	}

	#[cfg(any(feature = "doc", all(feature = "windows", windows)))]
	pub fn get_windows_timeouts(&self) -> std::io::Result<crate::os::windows::CommTimeouts> {
		unsafe {
			let mut timeouts = std::mem::zeroed();
			check_bool(GetCommTimeouts(self.file.as_raw_handle(), &mut timeouts))?;
			Ok(crate::os::windows::CommTimeouts {
				read_interval_timeout: timeouts.ReadIntervalTimeout,
				read_total_timeout_multiplier: timeouts.ReadTotalTimeoutMultiplier,
				read_total_timeout_constant: timeouts.ReadTotalTimeoutConstant,
				write_total_timeout_multiplier: timeouts.WriteTotalTimeoutMultiplier,
				write_total_timeout_constant: timeouts.WriteTotalTimeoutConstant,
			})
		}
	}

	#[cfg(any(feature = "doc", all(feature = "windows", windows)))]
	pub fn set_windows_timeouts(&self, timeouts: &crate::os::windows::CommTimeouts) -> std::io::Result<()> {
		let timeouts = COMMTIMEOUTS {
			ReadIntervalTimeout: timeouts.read_interval_timeout,
			ReadTotalTimeoutMultiplier: timeouts.read_total_timeout_multiplier,
			ReadTotalTimeoutConstant: timeouts.read_total_timeout_constant,
			WriteTotalTimeoutMultiplier: timeouts.write_total_timeout_multiplier,
			WriteTotalTimeoutConstant: timeouts.write_total_timeout_constant,
		};
		unsafe {
			check_bool(SetCommTimeouts(self.file.as_raw_handle(), &timeouts))?;
			Ok(())
		}
	}

	pub fn read(&self, buf: &mut [u8]) -> std::io::Result<usize> {
		unsafe {
			let len = buf.len().try_into().unwrap_or(u32::MAX);
			let event = Event::create(false, false)?;
			let mut read = 0;
			let mut overlapped: OVERLAPPED = std::mem::zeroed();
			overlapped.hEvent = event.as_raw_handle();
			let ret = check_bool(ReadFile(
				self.file.as_raw_handle(),
				buf.as_mut_ptr().cast(),
				len,
				&mut read,
				&mut overlapped,
			));
			match ret {
				// Windows reports timeouts as a succesfull transfer of 0 bytes.
				Ok(()) if read == 0 => return Err(std::io::ErrorKind::TimedOut.into()),
				Ok(()) => return Ok(read as usize),
				// BrokenPipe with reads means EOF on Windows.
				Err(ref e) if e.kind() == std::io::ErrorKind::BrokenPipe => return Ok(0),
				Err(ref e) if e.raw_os_error() == Some(ERROR_IO_PENDING as i32) => (),
				Err(e) => return Err(e),
			}

			wait_async_transfer(&self.file, &mut overlapped).or_else(map_broken_pipe)
		}
	}

	pub fn read_vectored(&self, buf: &mut [IoSliceMut<'_>]) -> std::io::Result<usize> {
		if buf.is_empty() {
			self.read(&mut [])
		} else {
			self.read(&mut buf[0])
		}
	}

	pub fn is_read_vectored(&self) -> bool {
		false
	}

	pub fn write(&self, buf: &[u8]) -> std::io::Result<usize> {
		unsafe {
			let len = buf.len().try_into().unwrap_or(u32::MAX);
			let event = Event::create(false, false)?;
			let mut written = 0;
			let mut overlapped: OVERLAPPED = std::mem::zeroed();
			overlapped.hEvent = event.as_raw_handle();
			let ret = check_bool(WriteFile(
				self.file.as_raw_handle(),
				buf.as_ptr().cast(),
				len,
				&mut written,
				&mut overlapped,
			));
			match ret {
				// Windows reports timeouts as a succesfull transfer of 0 bytes.
				Ok(()) if written == 0 => return Err(std::io::ErrorKind::TimedOut.into()),
				Ok(()) => return Ok(written as usize),
				Err(ref e) if e.raw_os_error() == Some(ERROR_IO_PENDING as i32) => (),
				Err(e) => return Err(e),
			}

			wait_async_transfer(&self.file, &mut overlapped)
		}
	}

	pub fn write_vectored(&self, buf: &[IoSlice<'_>]) -> std::io::Result<usize> {
		if buf.is_empty() {
			self.write(&[])
		} else {
			self.write(&buf[0])
		}
	}

	pub fn is_write_vectored(&self) -> bool {
		false
	}

	pub fn flush_output(&self) -> std::io::Result<()> {
		unsafe { check_bool(FlushFileBuffers(self.file.as_raw_handle())) }
	}

	pub fn discard_buffers(&self, discard_input: bool, discard_output: bool) -> std::io::Result<()> {
		unsafe {
			let mut flags = 0;
			if discard_input {
				flags |= PURGE_RXCLEAR;
			}
			if discard_output {
				flags |= PURGE_TXCLEAR;
			}
			check_bool(PurgeComm(self.file.as_raw_handle(), flags))
		}
	}

	pub fn set_rts(&self, state: bool) -> std::io::Result<()> {
		if state {
			escape_comm_function(&self.file, SETRTS)
		} else {
			escape_comm_function(&self.file, CLRRTS)
		}
	}

	pub fn read_cts(&self) -> std::io::Result<bool> {
		read_pin(&self.file, MS_CTS_ON)
	}

	pub fn set_dtr(&self, state: bool) -> std::io::Result<()> {
		if state {
			escape_comm_function(&self.file, SETDTR)
		} else {
			escape_comm_function(&self.file, CLRDTR)
		}
	}

	pub fn read_dsr(&self) -> std::io::Result<bool> {
		read_pin(&self.file, MS_DSR_ON)
	}

	pub fn read_ri(&self) -> std::io::Result<bool> {
		read_pin(&self.file, MS_RING_ON)
	}

	pub fn read_cd(&self) -> std::io::Result<bool> {
		// RLSD or Receive Line Signal Detect is the same as Carrier Detect.
		//
		// I think.
		read_pin(&self.file, MS_RLSD_ON)
	}

	pub fn set_break(&self, enable: bool) -> std::io::Result<()> {
		unsafe {
			if enable {
				check_bool(SetCommBreak(self.file.as_raw_handle()))
			} else {
				check_bool(ClearCommBreak(self.file.as_raw_handle()))
			}
		}
	}
}

struct Event {
	handle: OwnedHandle,
}

impl Event {
	fn create(manual_reset: bool, initially_signalled: bool) -> std::io::Result<Self> {
		unsafe {
			let manual_reset = if manual_reset { 1 } else { 0 };
			let initially_signalled = if initially_signalled { 1 } else { 0 };
			let handle = check_handle(CreateEventA(
				std::ptr::null_mut(), // security attributes
				manual_reset,
				initially_signalled,
				std::ptr::null(), // name
			))?;
			let handle = FromRawHandle::from_raw_handle(handle);
			Ok(Self { handle })
		}
	}
}

impl AsRawHandle for Event {
	fn as_raw_handle(&self) -> RawHandle {
		self.handle.as_raw_handle()
	}
}

fn map_broken_pipe(error: std::io::Error) -> std::io::Result<usize> {
	if error.kind() == std::io::ErrorKind::BrokenPipe {
		Ok(0)
	} else {
		Err(error)
	}
}

fn wait_async_transfer(file: &std::fs::File, overlapped: &mut OVERLAPPED) -> std::io::Result<usize> {
	unsafe {
		let mut transferred = 0;
		let ret = check_bool(GetOverlappedResult(
			file.as_raw_handle(),
			overlapped,
			&mut transferred,
			1,
		));
		match ret {
			// Windows reports timeouts as a succesfull transfer of 0 bytes.
			Ok(_) if transferred == 0 => Err(std::io::ErrorKind::TimedOut.into()),
			Ok(_) => Ok(transferred as usize),
			Err(e) => Err(e),
		}
	}
}

fn escape_comm_function(file: &std::fs::File, function: u32) -> std::io::Result<()> {
	unsafe { check_bool(EscapeCommFunction(file.as_raw_handle(), function)) }
}

fn read_pin(file: &std::fs::File, pin: u32) -> std::io::Result<bool> {
	unsafe {
		let mut bits: u32 = 0;
		check_bool(GetCommModemStatus(file.as_raw_handle(), &mut bits))?;
		Ok(bits & pin != 0)
	}
}

/// Check the return value of a syscall for errors.
fn check_bool(ret: BOOL) -> std::io::Result<()> {
	if ret == 0 {
		Err(std::io::Error::last_os_error())
	} else {
		Ok(())
	}
}

/// Check the return value of a syscall for errors.
fn check_handle(ret: RawHandle) -> std::io::Result<RawHandle> {
	if ret.is_null() {
		Err(std::io::Error::last_os_error())
	} else {
		Ok(ret)
	}
}

/// Create an std::io::Error with custom message.
fn other_error<E>(msg: E) -> std::io::Error
where
	E: Into<Box<dyn std::error::Error + Send + Sync>>,
{
	std::io::Error::new(std::io::ErrorKind::Other, msg)
}

impl Settings {
	pub fn set_raw(&mut self) {
		self.set_char_size(crate::CharSize::Bits8);
		self.set_stop_bits(crate::StopBits::One);
		self.set_parity(crate::Parity::None);
		self.set_flow_control(crate::FlowControl::None);
		self.dcb.set_fBinary(true);
		self.dcb.set_fErrorChar(false);
		self.dcb.set_fNull(false);
	}

	pub fn set_baud_rate(&mut self, baud_rate: u32) -> std::io::Result<()> {
		self.dcb.BaudRate = baud_rate;
		Ok(())
	}

	pub fn get_baud_rate(&self) -> std::io::Result<u32> {
		Ok(self.dcb.BaudRate)
	}

	pub fn set_char_size(&mut self, char_size: crate::CharSize) {
		self.dcb.ByteSize = match char_size {
			crate::CharSize::Bits5 => 5,
			crate::CharSize::Bits6 => 6,
			crate::CharSize::Bits7 => 7,
			crate::CharSize::Bits8 => 8,
		};
	}

	pub fn get_char_size(&self) -> std::io::Result<crate::CharSize> {
		match self.dcb.ByteSize {
			5 => Ok(crate::CharSize::Bits5),
			6 => Ok(crate::CharSize::Bits6),
			7 => Ok(crate::CharSize::Bits7),
			8 => Ok(crate::CharSize::Bits8),
			_ => Err(other_error("unsupported char size")),
		}
	}

	pub fn set_stop_bits(&mut self, stop_bits: crate::StopBits) {
		self.dcb.StopBits = match stop_bits {
			crate::StopBits::One => ONESTOPBIT,
			crate::StopBits::Two => TWOSTOPBITS,
		};
	}

	pub fn get_stop_bits(&self) -> std::io::Result<crate::StopBits> {
		match self.dcb.StopBits {
			ONESTOPBIT => Ok(crate::StopBits::One),
			TWOSTOPBITS => Ok(crate::StopBits::Two),
			_ => Err(other_error("unsupported stop bits")),
		}
	}

	pub fn set_parity(&mut self, parity: crate::Parity) {
		match parity {
			crate::Parity::None => {
				self.dcb.set_fParity(false);
				self.dcb.Parity = NOPARITY;
			},
			crate::Parity::Odd => {
				self.dcb.set_fParity(true);
				self.dcb.Parity = ODDPARITY;
			},
			crate::Parity::Even => {
				self.dcb.set_fParity(true);
				self.dcb.Parity = EVENPARITY;
			},
		}
	}

	pub fn get_parity(&self) -> std::io::Result<crate::Parity> {
		let parity_enabled = self.dcb.fParity();
		match self.dcb.Parity {
			NOPARITY => Ok(crate::Parity::None),
			ODDPARITY if parity_enabled => Ok(crate::Parity::Odd),
			EVENPARITY if parity_enabled => Ok(crate::Parity::Even),
			_ => Err(other_error("unsupported parity configuration")),
		}
	}

	pub fn set_flow_control(&mut self, flow_control: crate::FlowControl) {
		match flow_control {
			crate::FlowControl::None => {
				self.dcb.set_fInX(false);
				self.dcb.set_fOutX(false);
				self.dcb.set_fDtrControl(DTR_CONTROL_DISABLE);
				self.dcb.set_fDsrSensitivity(false);
				self.dcb.set_fOutxDsrFlow(false);
				self.dcb.set_fRtsControl(RTS_CONTROL_DISABLE);
				self.dcb.set_fOutxCtsFlow(false);
			},
			crate::FlowControl::XonXoff => {
				self.dcb.set_fInX(true);
				self.dcb.set_fOutX(true);
				self.dcb.set_fDtrControl(DTR_CONTROL_DISABLE);
				self.dcb.set_fDsrSensitivity(false);
				self.dcb.set_fOutxDsrFlow(false);
				self.dcb.set_fRtsControl(RTS_CONTROL_DISABLE);
				self.dcb.set_fOutxCtsFlow(false);
			},
			crate::FlowControl::RtsCts => {
				self.dcb.set_fInX(false);
				self.dcb.set_fOutX(false);
				self.dcb.set_fDtrControl(DTR_CONTROL_DISABLE);
				self.dcb.set_fDsrSensitivity(false);
				self.dcb.set_fOutxDsrFlow(false);
				self.dcb.set_fRtsControl(RTS_CONTROL_TOGGLE);
				self.dcb.set_fOutxCtsFlow(true);
			},
		}
	}

	#[rustfmt::skip]
	pub fn get_flow_control(&self) -> std::io::Result<crate::FlowControl> {
		let in_x = self.dcb.fInX();
		let out_x = self.dcb.fOutX();
		let out_cts = self.dcb.fOutxCtsFlow();
		let out_dsr = self.dcb.fOutxDsrFlow();

		match (in_x, out_x, out_cts, out_dsr, self.dcb.fDtrControl(), self.dcb.fRtsControl()) {
			(false, false, false, false, DTR_CONTROL_DISABLE, RTS_CONTROL_DISABLE) => {
				Ok(crate::FlowControl::None)
			},
			(true, true, false, false, DTR_CONTROL_DISABLE, RTS_CONTROL_DISABLE) => {
				Ok(crate::FlowControl::XonXoff)
			},
			(false, false, true, false, DTR_CONTROL_DISABLE, RTS_CONTROL_TOGGLE) => {
				Ok(crate::FlowControl::RtsCts)
			},
			_ => Err(other_error("unsupported flow control configuration")),
		}
	}
}

#[derive(Debug)]
struct RegKey {
	key: HKEY,
}

impl RegKey {
	fn open(parent: HKEY, subpath: PCSTR, rights: REG_SAM_FLAGS) -> std::io::Result<Self> {
		unsafe {
			let mut key: HKEY = std::ptr::null_mut();
			let status = RegOpenKeyExA(parent, subpath, 0, rights, &mut key);
			if status != 0 {
				Err(std::io::Error::from_raw_os_error(status as i32))
			} else {
				Ok(Self { key })
			}
		}
	}

	fn get_value_info(&self) -> std::io::Result<(u32, u32, u32)> {
		unsafe {
			let mut value_count: u32 = 0;
			let mut max_value_name_len: u32 = 0;
			let mut max_value_data_len: u32 = 0;
			let status = RegQueryInfoKeyA(
				self.key,
				std::ptr::null_mut(),
				std::ptr::null_mut(),
				std::ptr::null_mut(),
				std::ptr::null_mut(),
				std::ptr::null_mut(),
				std::ptr::null_mut(),
				&mut value_count,
				&mut max_value_name_len,
				&mut max_value_data_len,
				std::ptr::null_mut(),
				std::ptr::null_mut(),
			);
			if status != 0 {
				Err(std::io::Error::from_raw_os_error(status as i32))
			} else {
				Ok((value_count, max_value_name_len, max_value_data_len))
			}
		}
	}

	fn get_string_value(
		&self,
		index: u32,
		max_name_len: u32,
		max_data_len: u32,
	) -> std::io::Result<Option<(Vec<u8>, Vec<u8>)>> {
		unsafe {
			let mut name = vec![0u8; max_name_len as usize + 1];
			let mut data = vec![0u8; max_data_len as usize];
			let mut name_len = name.len() as u32;
			let mut data_len = data.len() as u32;
			let mut kind = 0;
			let status = RegEnumValueA(
				self.key,
				index,
				name.as_mut_ptr().cast(),
				&mut name_len,
				std::ptr::null_mut(),
				&mut kind,
				data.as_mut_ptr().cast(),
				&mut data_len,
			);
			if status == ERROR_NO_MORE_ITEMS {
				Ok(None)
			} else if status != 0 {
				Err(std::io::Error::from_raw_os_error(status as i32))
			} else if kind != REG_SZ {
				Ok(None)
			} else {
				name.truncate(name_len as usize + 1);
				data.truncate(data_len as usize);
				Ok(Some((name, data)))
			}
		}
	}
}

impl Drop for RegKey {
	fn drop(&mut self) {
		unsafe {
			RegCloseKey(self.key);
		}
	}
}

pub fn enumerate() -> std::io::Result<Vec<PathBuf>> {
	let subkey = windows_sys::s!("Hardware\\DEVICEMAP\\SERIALCOMM");
	let device_map = match RegKey::open(HKEY_LOCAL_MACHINE, subkey, KEY_READ) {
		Ok(x) => x,
		Err(ref e) if e.kind() == std::io::ErrorKind::NotFound => {
			// The registry key doesn't exist until a serial port was available at-least once.
			return Ok(Vec::new());
		},
		Err(e) => return Err(e),
	};

	let (value_count, max_value_name_len, max_value_data_len) = device_map.get_value_info()?;

	let mut entries = Vec::with_capacity(16);
	for i in 0..value_count {
		let mut name = match device_map.get_string_value(i, max_value_name_len, max_value_data_len) {
			Ok(Some((_name, data))) => data,
			Ok(None) => continue,
			Err(_) => continue,
		};
		if let Some(i) = name.iter().rposition(|&b| b != 0) {
			name.truncate(i + 1);
			if let Ok(name) = String::from_utf8(name) {
				entries.push(name.into());
			}
		}
	}

	Ok(entries)
}

#[allow(non_snake_case)]
pub(crate) trait DCBBitField {
	fn set_fBinary(&mut self, value: bool);
	fn set_fParity(&mut self, value: bool);
	fn set_fOutxCtsFlow(&mut self, value: bool);
	fn set_fOutxDsrFlow(&mut self, value: bool);
	fn set_fDtrControl(&mut self, value: u32);
	fn set_fDsrSensitivity(&mut self, value: bool);
	fn set_fOutX(&mut self, value: bool);
	fn set_fInX(&mut self, value: bool);
	fn set_fErrorChar(&mut self, value: bool);
	fn set_fNull(&mut self, value: bool);
	fn set_fRtsControl(&mut self, value: u32);

	fn fParity(&self) -> bool;
	fn fOutxCtsFlow(&self) -> bool;
	fn fOutxDsrFlow(&self) -> bool;
	fn fRtsControl(&self) -> u32;
	fn fDtrControl(&self) -> u32;
	fn fOutX(&self) -> bool;
	fn fInX(&self) -> bool;
}

impl DCBBitField for DCB {
	fn set_fBinary(&mut self, value: bool) {
		if value {
			self._bitfield |= 1 << 0;
		} else {
			self._bitfield &= !(1 << 0);
		}
	}

	fn set_fParity(&mut self, value: bool) {
		if value {
			self._bitfield |= 1 << 1;
		} else {
			self._bitfield &= !(1 << 1);
		}
	}

	fn set_fOutxCtsFlow(&mut self, value: bool) {
		if value {
			self._bitfield |= 1 << 2;
		} else {
			self._bitfield &= !(1 << 2);
		}
	}

	fn set_fOutxDsrFlow(&mut self, value: bool) {
		if value {
			self._bitfield |= 1 << 3;
		} else {
			self._bitfield &= !(1 << 3);
		}
	}

	fn set_fDtrControl(&mut self, value: u32) {
		// Clear bits 4-5 and set new value
		self._bitfield &= !(0b11 << 4);
		self._bitfield |= (value & 0b11) << 4;
	}

	fn set_fDsrSensitivity(&mut self, value: bool) {
		if value {
			self._bitfield |= 1 << 6;
		} else {
			self._bitfield &= !(1 << 6);
		}
	}

	fn set_fOutX(&mut self, value: bool) {
		if value {
			self._bitfield |= 1 << 8;
		} else {
			self._bitfield &= !(1 << 8);
		}
	}

	fn set_fInX(&mut self, value: bool) {
		if value {
			self._bitfield |= 1 << 9;
		} else {
			self._bitfield &= !(1 << 9);
		}
	}

	fn set_fErrorChar(&mut self, value: bool) {
		if value {
			self._bitfield |= 1 << 10;
		} else {
			self._bitfield &= !(1 << 10);
		}
	}

	fn set_fNull(&mut self, value: bool) {
		if value {
			self._bitfield |= 1 << 11;
		} else {
			self._bitfield &= !(1 << 11);
		}
	}

	fn set_fRtsControl(&mut self, value: u32) {
		// Clear bits 12-13 and set new value
		self._bitfield &= !(0b11 << 12);
		self._bitfield |= (value & 0b11) << 12;
	}

	fn fParity(&self) -> bool {
		(self._bitfield & (1 << 1)) != 0
	}

	fn fOutxCtsFlow(&self) -> bool {
		(self._bitfield & (1 << 2)) != 0
	}

	fn fOutxDsrFlow(&self) -> bool {
		(self._bitfield & (1 << 3)) != 0
	}

	fn fRtsControl(&self) -> u32 {
		(self._bitfield >> 12) & 0b11
	}

	fn fDtrControl(&self) -> u32 {
		(self._bitfield >> 4) & 0b11
	}

	fn fOutX(&self) -> bool {
		(self._bitfield & (1 << 8)) != 0
	}

	fn fInX(&self) -> bool {
		(self._bitfield & (1 << 9)) != 0
	}
}
