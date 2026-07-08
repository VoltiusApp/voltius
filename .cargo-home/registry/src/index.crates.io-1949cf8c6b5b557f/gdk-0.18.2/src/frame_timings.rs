// Take a look at the license at the top of the repository in the LICENSE file.

use crate::FrameTimings;
use glib::translate::*;
use std::num::NonZeroU64;

impl FrameTimings {
    #[doc(alias = "gdk_frame_timings_get_predicted_presentation_time")]
    #[doc(alias = "get_predicted_presentation_time")]
    pub fn predicted_presentation_time(&self) -> Option<NonZeroU64> {
        let predicted_presentation_time = unsafe {
            ffi::gdk_frame_timings_get_predicted_presentation_time(self.to_glib_none().0)
        };
        // assuming presentation time is always positive
        assert!(predicted_presentation_time >= 0);
        // `0` means the value is not available
        NonZeroU64::new(predicted_presentation_time as u64)
    }

    #[doc(alias = "gdk_frame_timings_get_presentation_time")]
    #[doc(alias = "get_presentation_time")]
    pub fn presentation_time(&self) -> Option<NonZeroU64> {
        let presentation_time =
            unsafe { ffi::gdk_frame_timings_get_presentation_time(self.to_glib_none().0) };
        // assuming presentation time is always positive
        assert!(presentation_time >= 0);
        // `0` means the value is not available
        NonZeroU64::new(presentation_time as u64)
    }

    #[doc(alias = "gdk_frame_timings_get_refresh_interval")]
    #[doc(alias = "get_refresh_interval")]
    pub fn refresh_interval(&self) -> Option<NonZeroU64> {
        let refresh_interval =
            unsafe { ffi::gdk_frame_timings_get_refresh_interval(self.to_glib_none().0) };
        // assuming refresh interval is always positive
        assert!(refresh_interval >= 0);
        // `0` means the value is not available
        NonZeroU64::new(refresh_interval as u64)
    }
}
