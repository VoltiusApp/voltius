use super::seal::{self, PlatformSealer, SealOutcome, Sealer};
use super::VerifyOutcome;
use ring::rand::{SecureRandom, SystemRandom};
use tauri::Manager;
use windows::core::Array;
use windows::core::{factory, HSTRING};
use windows::Security::Credentials::UI::{
    UserConsentVerificationResult, UserConsentVerifier, UserConsentVerifierAvailability,
};
use windows::Security::Credentials::{
    KeyCredential, KeyCredentialCreationOption, KeyCredentialManager, KeyCredentialRetrievalResult,
    KeyCredentialStatus,
};
use windows::Security::Cryptography::CryptographicBuffer;
use windows::Win32::Foundation::HWND;
use windows::Win32::System::WinRT::IUserConsentVerifierInterop;
use windows_future::IAsyncOperation;
use zeroize::Zeroizing;

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

pub(super) fn map_status(s: KeyCredentialStatus) -> SealOutcome {
    match s {
        KeyCredentialStatus::NotFound => SealOutcome::Invalidated,
        KeyCredentialStatus::UserCanceled | KeyCredentialStatus::UserPrefersPassword => {
            SealOutcome::Cancelled
        }
        KeyCredentialStatus::SecurityDeviceLocked => SealOutcome::Unavailable,
        _ => SealOutcome::Failed,
    }
}

fn key_name() -> HSTRING {
    HSTRING::from(format!("{}-vault", crate::commands::keychain::service()))
}

fn retrieved(
    op: windows::core::Result<IAsyncOperation<KeyCredentialRetrievalResult>>,
) -> Result<KeyCredential, SealOutcome> {
    let result = op.and_then(|o| o.get()).map_err(|_| SealOutcome::Failed)?;
    match result.Status().map_err(|_| SealOutcome::Failed)? {
        KeyCredentialStatus::Success => result.Credential().map_err(|_| SealOutcome::Failed),
        other => Err(map_status(other)),
    }
}

fn open_credential() -> Result<KeyCredential, SealOutcome> {
    retrieved(KeyCredentialManager::OpenAsync(&key_name()))
}

fn open_or_create_credential() -> Result<KeyCredential, SealOutcome> {
    match open_credential() {
        Err(SealOutcome::Invalidated) => retrieved(KeyCredentialManager::RequestCreateAsync(
            &key_name(),
            KeyCredentialCreationOption::FailIfExists,
        )),
        other => other,
    }
}

fn sign(cred: &KeyCredential, salt: &[u8; 32]) -> Result<Zeroizing<Vec<u8>>, SealOutcome> {
    let challenge =
        CryptographicBuffer::CreateFromByteArray(salt).map_err(|_| SealOutcome::Failed)?;
    let result = cred
        .RequestSignAsync(&challenge)
        .and_then(|o| o.get())
        .map_err(|_| SealOutcome::Failed)?;
    match result.Status().map_err(|_| SealOutcome::Failed)? {
        KeyCredentialStatus::Success => {
            let buf = result.Result().map_err(|_| SealOutcome::Failed)?;
            let mut out = Array::<u8>::new();
            CryptographicBuffer::CopyToByteArray(&buf, &mut out)
                .map_err(|_| SealOutcome::Failed)?;
            Ok(Zeroizing::new(out.to_vec()))
        }
        other => Err(map_status(other)),
    }
}

fn seal_blocking(plaintext: Zeroizing<Vec<u8>>) -> SealOutcome {
    let mut salt = [0u8; 32];
    if SystemRandom::new().fill(&mut salt).is_err() {
        return SealOutcome::Failed;
    }
    let sig = match open_or_create_credential().and_then(|c| sign(&c, &salt)) {
        Ok(sig) => sig,
        Err(o) => return o,
    };
    seal::seal_with_signature(&sig, &salt, &plaintext).map_or(SealOutcome::Failed, |body| {
        SealOutcome::Ok(seal::frame(seal::WINDOWS, &body))
    })
}

fn unseal_blocking(blob: Vec<u8>) -> SealOutcome {
    let Some(body) = seal::unframe(seal::WINDOWS, &blob) else {
        return SealOutcome::Invalidated;
    };
    let Some(salt) = seal::salt_of(body) else {
        return SealOutcome::Invalidated;
    };
    let sig = match open_credential().and_then(|c| sign(&c, &salt)) {
        Ok(sig) => sig,
        Err(o) => return o,
    };
    // A signature that no longer opens the blob means the Hello key was replaced.
    seal::open_with_signature(&sig, body).map_or(SealOutcome::Invalidated, SealOutcome::Ok)
}

impl Sealer for PlatformSealer {
    fn available(&self) -> bool {
        KeyCredentialManager::IsSupportedAsync()
            .and_then(|op| op.get())
            .unwrap_or(false)
    }

    async fn seal(&self, _reason: &str, plaintext: &[u8]) -> SealOutcome {
        let pt = Zeroizing::new(plaintext.to_vec());
        tauri::async_runtime::spawn_blocking(move || seal_blocking(pt))
            .await
            .unwrap_or(SealOutcome::Failed)
    }

    async fn unseal(&self, _reason: &str, blob: &[u8]) -> SealOutcome {
        let blob = blob.to_vec();
        tauri::async_runtime::spawn_blocking(move || unseal_blocking(blob))
            .await
            .unwrap_or(SealOutcome::Failed)
    }
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

    #[test]
    fn key_credential_statuses_map_to_seal_outcomes() {
        use windows::Security::Credentials::KeyCredentialStatus as S;
        assert_eq!(map_status(S::NotFound), SealOutcome::Invalidated);
        assert_eq!(map_status(S::UserCanceled), SealOutcome::Cancelled);
        assert_eq!(map_status(S::UserPrefersPassword), SealOutcome::Cancelled);
        assert_eq!(
            map_status(S::SecurityDeviceLocked),
            SealOutcome::Unavailable
        );
        assert_eq!(map_status(S::UnknownError), SealOutcome::Failed);
    }
}
