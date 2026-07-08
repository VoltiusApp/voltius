// Take a look at the license at the top of the repository in the LICENSE file.

use glib::translate::*;
use glib::Slice;
use std::ptr;

#[doc(alias = "gtk_accelerator_parse_with_keycode")]
pub fn accelerator_parse_with_keycode(
    accelerator: &str,
) -> Option<(u32, Slice<u32>, gdk::ModifierType)> {
    assert_initialized_main_thread!();
    unsafe {
        let mut accelerator_key = std::mem::MaybeUninit::uninit();
        let mut accelerator_codes_ptr = ptr::null_mut();
        let mut accelerator_mods = std::mem::MaybeUninit::uninit();
        ffi::gtk_accelerator_parse_with_keycode(
            accelerator.to_glib_none().0,
            accelerator_key.as_mut_ptr(),
            &mut accelerator_codes_ptr,
            accelerator_mods.as_mut_ptr(),
        );
        if !accelerator_codes_ptr.is_null() {
            let mut len = 0;
            if !accelerator_codes_ptr.is_null() {
                while ptr::read(accelerator_codes_ptr.add(len)) != 0 {
                    len += 1;
                }
            }
            let accelerator_codes = Slice::from_glib_full_num(accelerator_codes_ptr, len);
            Some((
                accelerator_key.assume_init(),
                accelerator_codes,
                from_glib(accelerator_mods.assume_init()),
            ))
        } else {
            None
        }
    }
}
