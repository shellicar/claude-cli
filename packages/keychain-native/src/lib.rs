#![deny(clippy::all)]

use napi_derive::napi;
use security_framework::passwords::get_generic_password;

/// Read a generic password from the macOS Keychain by service and account name.
/// Returns the stored secret as a UTF-8 string. Errors if the item is absent,
/// access is denied (the caller isn't on the item's trusted-app list, or the
/// Keychain prompt was declined), or the stored bytes aren't valid UTF-8.
#[napi]
pub fn read_generic_password(service: String, account: String) -> napi::Result<String> {
  let bytes = get_generic_password(&service, &account)
    .map_err(|e| napi::Error::from_reason(format!("keychain read failed: {e}")))?;
  String::from_utf8(bytes)
    .map_err(|e| napi::Error::from_reason(format!("keychain value is not valid UTF-8: {e}")))
}
