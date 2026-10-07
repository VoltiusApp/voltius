use super::VerifyOutcome;
use tauri::Manager;
use windows::core::{factory, HSTRING};
use windows::Security::Credentials::UI::{
    UserConsentVerificationResult, UserConsentVerifier, UserConsentVerifierAvailability,
};
use windows::Win32::Foundation::HWND;
use windows::Win32::System::WinRT::IUserConsentVerifierInterop;
use windows_future::IAsyncOperation;

pub(super) fn map_result(r: UserConsentVerificationResult) -> VerifyOutcome {
    match r {
        UserConsentVerificationResult::Verified => VerifyOutcome::Ok,
        UserConsentVerificationResult::Canceled => VerifyOutcome::Cancelled,
        UserConsentVerificationResult::DeviceNotPresent
        | UserConsentVerificationResult::NotConfiguredForUser
        | UserConsentVerificationResult::DisabledByPolicy => VerifyOutcome::Unavailable,
        _ => VerifyOutcome::Failed,
    }
}

pub fn available() -> bool {
    UserConsentVerifier::CheckAvailabilityAsync()
        .and_then(|op| op.get())
        .is_ok_and(|a| a == UserConsentVerifierAvailability::Available)
}

fn request(hwnd: isize, reason: &str) -> windows::core::Result<UserConsentVerificationResult> {
    let interop = factory::<UserConsentVerifier, IUserConsentVerifierInterop>()?;
    // The window-handle variant parents the Hello dialog to our window instead of behind it.
    let op: IAsyncOperation<UserConsentVerificationResult> = unsafe {
        interop.RequestVerificationForWindowAsync(HWND(hwnd as _), &HSTRING::from(reason))?
    };
    op.get()
}

pub async fn verify(app: &tauri::AppHandle, reason: &str) -> VerifyOutcome {
    let Some(hwnd) = app
        .get_webview_window("main")
        .and_then(|w| w.hwnd().ok())
        .map(|h| h.0 as isize)
    else {
        return VerifyOutcome::Unavailable;
    };
    let reason = reason.to_string();
    tauri::async_runtime::spawn_blocking(move || {
        request(hwnd, &reason).map_or(VerifyOutcome::Failed, map_result)
    })
    .await
    .unwrap_or(VerifyOutcome::Failed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use windows::Security::Credentials::UI::UserConsentVerificationResult as R;

    #[test]
    fn hello_results_map_to_outcomes() {
        assert_eq!(map_result(R::Verified), VerifyOutcome::Ok);
        assert_eq!(map_result(R::Canceled), VerifyOutcome::Cancelled);
        assert_eq!(map_result(R::DeviceNotPresent), VerifyOutcome::Unavailable);
        assert_eq!(
            map_result(R::NotConfiguredForUser),
            VerifyOutcome::Unavailable
        );
        assert_eq!(map_result(R::DisabledByPolicy), VerifyOutcome::Unavailable);
        assert_eq!(map_result(R::RetriesExhausted), VerifyOutcome::Failed);
    }
}
