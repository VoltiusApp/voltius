// Take a look at the license at the top of the repository in the LICENSE file.

use glib::translate::*;
use libc::c_void;
use std::fmt;
use std::mem;
use std::ptr;

use crate::AxisUse;
use crate::Device;
use crate::DeviceTool;
use crate::EventSequence;
use crate::EventType;
use crate::ModifierType;
use crate::Screen;
use crate::ScrollDirection;
use crate::Seat;
use crate::Window;

glib::wrapper! {
    /// A generic GDK event.
    #[derive(PartialEq, Eq, PartialOrd, Ord, Hash)]
    #[doc(alias = "GdkEvent")]
    pub struct Event(Boxed<ffi::GdkEvent>);

    match fn {
        copy => |ptr| ffi::gdk_event_copy(ptr),
        free => |ptr| ffi::gdk_event_free(ptr),
        type_ => || ffi::gdk_event_get_type(),
    }
}

impl Event {
    /// Creates a new event.
    #[doc(alias = "gdk_event_new")]
    pub fn new(type_: EventType) -> Event {
        assert_initialized_main_thread!();
        unsafe { from_glib_none(ffi::gdk_event_new(type_.into_glib())) }
    }

    #[doc(alias = "gdk_event_get")]
    pub fn get() -> Option<Event> {
        assert_initialized_main_thread!();
        unsafe { from_glib_none(ffi::gdk_event_get()) }
    }

    #[doc(alias = "gdk_event_put")]
    pub fn put(&self) {
        unsafe { ffi::gdk_event_put(self.to_glib_none().0) }
    }

    /// Set the event handler.
    ///
    /// The callback `handler` is called for each event. If `None`, event
    /// handling is disabled.
    #[doc(alias = "gdk_event_handler_set")]
    pub fn set_handler<F: Fn(&mut Event) + 'static>(handler: Option<F>) {
        assert_initialized_main_thread!();
        unsafe extern "C" fn event_handler_trampoline<F: Fn(&mut Event) + 'static>(
            event: *mut ffi::GdkEvent,
            ptr: glib::ffi::gpointer,
        ) {
            if !ptr.is_null() {
                let f: &F = &*(ptr as *mut _);
                let mut event = from_glib_none(event);
                f(&mut event)
            }
        }
        unsafe extern "C" fn event_handler_destroy<F: Fn(&mut Event) + 'static>(
            ptr: glib::ffi::gpointer,
        ) {
            if !ptr.is_null() {
                // convert back to Box and free
                let _boxed: Box<F> = Box::from_raw(ptr as *mut _);
            }
        }
        if let Some(handler) = handler {
            // allocate and convert to target type
            // double box to reduce a fat pointer to a simple pointer
            let boxed: Box<F> = Box::new(handler);
            let ptr: *mut c_void = Box::into_raw(boxed) as *mut _;
            unsafe {
                ffi::gdk_event_handler_set(
                    Some(event_handler_trampoline::<F>),
                    ptr,
                    Some(event_handler_destroy::<F>),
                )
            }
        } else {
            unsafe { ffi::gdk_event_handler_set(None, ptr::null_mut(), None) }
        }
    }

    #[doc(alias = "gdk_event_get_axis")]
    #[doc(alias = "get_axis")]
    pub fn axis(&self, axis_use: AxisUse) -> Option<f64> {
        let mut value = 0f64;
        if unsafe {
            from_glib(ffi::gdk_event_get_axis(
                self.to_glib_none().0,
                axis_use.into_glib(),
                &mut value,
            ))
        } {
            Some(value)
        } else {
            None
        }
    }

    #[doc(alias = "gdk_event_get_button")]
    #[doc(alias = "get_button")]
    pub fn button(&self) -> Option<u32> {
        let mut button = 0u32;
        if unsafe {
            from_glib(ffi::gdk_event_get_button(
                self.to_glib_none().0,
                &mut button,
            ))
        } {
            Some(button)
        } else {
            None
        }
    }

    #[doc(alias = "gdk_event_get_click_count")]
    #[doc(alias = "get_click_count")]
    pub fn click_count(&self) -> Option<u32> {
        let mut click_count = 0u32;
        if unsafe {
            from_glib(ffi::gdk_event_get_click_count(
                self.to_glib_none().0,
                &mut click_count,
            ))
        } {
            Some(click_count)
        } else {
            None
        }
    }

    #[doc(alias = "gdk_event_get_coords")]
    #[doc(alias = "get_coords")]
    pub fn coords(&self) -> Option<(f64, f64)> {
        let mut x_win = 0f64;
        let mut y_win = 0f64;
        if unsafe {
            from_glib(ffi::gdk_event_get_coords(
                self.to_glib_none().0,
                &mut x_win,
                &mut y_win,
            ))
        } {
            Some((x_win, y_win))
        } else {
            None
        }
    }

    #[doc(alias = "gdk_event_get_keycode")]
    #[doc(alias = "get_keycode")]
    pub fn keycode(&self) -> Option<u16> {
        let mut keycode = 0u16;
        if unsafe {
            from_glib(ffi::gdk_event_get_keycode(
                self.to_glib_none().0,
                &mut keycode,
            ))
        } {
            Some(keycode)
        } else {
            None
        }
    }

    #[doc(alias = "gdk_event_get_keyval")]
    #[doc(alias = "get_keyval")]
    pub fn keyval(&self) -> Option<u32> {
        let mut keyval = 0u32;
        if unsafe {
            from_glib(ffi::gdk_event_get_keyval(
                self.to_glib_none().0,
                &mut keyval,
            ))
        } {
            Some(keyval)
        } else {
            None
        }
    }

    #[doc(alias = "gdk_event_get_root_coords")]
    #[doc(alias = "get_root_coords")]
    pub fn root_coords(&self) -> Option<(f64, f64)> {
        let mut x_root = 0f64;
        let mut y_root = 0f64;
        if unsafe {
            from_glib(ffi::gdk_event_get_root_coords(
                self.to_glib_none().0,
                &mut x_root,
                &mut y_root,
            ))
        } {
            Some((x_root, y_root))
        } else {
            None
        }
    }

    #[doc(alias = "gdk_event_get_scroll_direction")]
    #[doc(alias = "get_scroll_direction")]
    pub fn scroll_direction(&self) -> Option<ScrollDirection> {
        unsafe {
            let mut direction = mem::MaybeUninit::uninit();
            if from_glib(ffi::gdk_event_get_scroll_direction(
                self.to_glib_none().0,
                direction.as_mut_ptr(),
            )) {
                Some(from_glib(direction.assume_init()))
            } else {
                None
            }
        }
    }

    #[doc(alias = "gdk_event_get_scroll_deltas")]
    #[doc(alias = "get_scroll_deltas")]
    pub fn scroll_deltas(&self) -> Option<(f64, f64)> {
        let mut delta_x = 0f64;
        let mut delta_y = 0f64;
        if unsafe {
            from_glib(ffi::gdk_event_get_scroll_deltas(
                self.to_glib_none().0,
                &mut delta_x,
                &mut delta_y,
            ))
        } {
            Some((delta_x, delta_y))
        } else {
            None
        }
    }

    #[doc(alias = "gdk_event_is_scroll_stop_event")]
    pub fn is_scroll_stop_event(&self) -> bool {
        unsafe { from_glib(ffi::gdk_event_is_scroll_stop_event(self.to_glib_none().0)) }
    }

    #[doc(alias = "gdk_event_get_state")]
    #[doc(alias = "get_state")]
    pub fn state(&self) -> Option<ModifierType> {
        unsafe {
            let mut state = mem::MaybeUninit::uninit();
            if from_glib(ffi::gdk_event_get_state(
                self.to_glib_none().0,
                state.as_mut_ptr(),
            )) {
                Some(from_glib(state.assume_init() as _))
            } else {
                None
            }
        }
    }

    #[doc(alias = "gdk_event_get_time")]
    #[doc(alias = "get_time")]
    pub fn time(&self) -> u32 {
        unsafe { ffi::gdk_event_get_time(self.to_glib_none().0) }
    }

    /// Returns the associated `Window` if applicable.
    #[doc(alias = "gdk_event_get_window")]
    #[doc(alias = "get_window")]
    pub fn window(&self) -> Option<Window> {
        unsafe { from_glib_none(ffi::gdk_event_get_window(self.to_glib_none().0)) }
    }

    #[doc(alias = "gdk_event_get_event_sequence")]
    #[doc(alias = "get_event_sequence")]
    pub fn event_sequence(&self) -> Option<EventSequence> {
        unsafe { from_glib_none(ffi::gdk_event_get_event_sequence(self.to_glib_none().0)) }
    }

    #[doc(alias = "gdk_event_triggers_context_menu")]
    pub fn triggers_context_menu(&self) -> bool {
        unsafe { from_glib(ffi::gdk_event_triggers_context_menu(self.to_glib_none().0)) }
    }

    #[doc(alias = "gdk_event_get_seat")]
    #[doc(alias = "get_seat")]
    pub fn seat(&self) -> Option<Seat> {
        unsafe { from_glib_none(ffi::gdk_event_get_seat(self.to_glib_none().0)) }
    }

    #[doc(alias = "gdk_event_get_scancode")]
    #[doc(alias = "get_scancode")]
    pub fn scancode(&self) -> i32 {
        unsafe { ffi::gdk_event_get_scancode(mut_override(self.to_glib_none().0)) }
    }

    #[doc(alias = "gdk_event_get_pointer_emulated")]
    #[doc(alias = "get_pointer_emulated")]
    pub fn is_pointer_emulated(&self) -> bool {
        unsafe {
            from_glib(ffi::gdk_event_get_pointer_emulated(mut_override(
                self.to_glib_none().0,
            )))
        }
    }

    #[doc(alias = "gdk_event_set_screen")]
    pub fn set_screen(&mut self, screen: Option<&Screen>) {
        unsafe { ffi::gdk_event_set_screen(self.to_glib_none_mut().0, screen.to_glib_none().0) }
    }

    #[doc(alias = "gdk_event_get_screen")]
    #[doc(alias = "get_screen")]
    pub fn screen(&self) -> Option<Screen> {
        unsafe { from_glib_none(ffi::gdk_event_get_screen(self.to_glib_none().0)) }
    }

    #[doc(alias = "gdk_event_set_device")]
    pub fn set_device(&mut self, device: Option<&Device>) {
        unsafe { ffi::gdk_event_set_device(self.to_glib_none_mut().0, device.to_glib_none().0) }
    }

    #[doc(alias = "gdk_event_get_device")]
    #[doc(alias = "get_device")]
    pub fn device(&self) -> Option<Device> {
        unsafe { from_glib_none(ffi::gdk_event_get_device(self.to_glib_none().0)) }
    }

    #[doc(alias = "gdk_event_set_source_device")]
    pub fn set_source_device(&mut self, device: Option<&Device>) {
        unsafe {
            ffi::gdk_event_set_source_device(self.to_glib_none_mut().0, device.to_glib_none().0)
        }
    }

    #[doc(alias = "gdk_event_get_source_device")]
    #[doc(alias = "get_source_device")]
    pub fn source_device(&self) -> Option<Device> {
        unsafe { from_glib_none(ffi::gdk_event_get_source_device(self.to_glib_none().0)) }
    }

    #[doc(alias = "gdk_event_set_device_tool")]
    pub fn set_device_tool(&mut self, device: Option<&DeviceTool>) {
        unsafe {
            ffi::gdk_event_set_device_tool(self.to_glib_none_mut().0, device.to_glib_none().0)
        }
    }

    #[doc(alias = "gdk_event_get_device_tool")]
    #[doc(alias = "get_device_tool")]
    pub fn device_tool(&self) -> Option<DeviceTool> {
        unsafe { from_glib_none(ffi::gdk_event_get_device_tool(self.to_glib_none().0)) }
    }

    /// Returns the event type.
    #[doc(alias = "get_event_type")]
    pub fn event_type(&self) -> EventType {
        unsafe { from_glib(self.as_ref().type_) }
    }

    /// Returns whether the event was sent explicitly.
    #[allow(clippy::cast_lossless)]
    #[doc(alias = "get_send_event")]
    pub fn is_send_event(&self) -> bool {
        unsafe { from_glib(self.as_ref().send_event as i32) }
    }

    /// Returns `true` if the event type matches `T`.
    pub fn is<T: FromEvent>(&self) -> bool {
        T::is(self)
    }

    /// Tries to downcast to a specific event type.
    pub fn downcast<T: FromEvent>(self) -> Result<T, Self> {
        T::from(self)
    }

    /// Tries to downcast to a specific event type.
    pub fn downcast_ref<T: FromEvent>(&self) -> Option<&T> {
        if T::is(self) {
            unsafe { Some(&*(self as *const _ as *const _)) }
        } else {
            None
        }
    }

    /// Tries to downcast to a specific event type.
    pub fn downcast_mut<T: FromEvent>(&mut self) -> Option<&mut T> {
        if T::is(self) {
            unsafe { Some(&mut *(self as *mut _ as *mut _)) }
        } else {
            None
        }
    }
}

impl fmt::Debug for Event {
    fn fmt(&self, fmt: &mut fmt::Formatter) -> Result<(), fmt::Error> {
        fmt.debug_struct("Event")
            .field("inner", &self.inner)
            .field("type", &self.event_type())
            .finish()
    }
}

/// A helper trait implemented by all event subtypes.
pub unsafe trait FromEvent: Sized {
    fn is(ev: &Event) -> bool;
    fn from(ev: Event) -> Result<Self, Event>;
}

macro_rules! event_wrapper {
    ($name:ident, $ffi_name:ident) => {
        impl<'a> ToGlibPtr<'a, *const ::ffi::$ffi_name> for $name {
            type Storage = &'a Self;

            #[inline]
            fn to_glib_none(&'a self) -> Stash<'a, *const ::ffi::$ffi_name, Self> {
                let ptr =
                    <$crate::Event as ToGlibPtr<*const ::ffi::GdkEvent>>::to_glib_none(&*self).0;
                Stash(ptr as *const ::ffi::$ffi_name, self)
            }
        }

        impl<'a> ToGlibPtrMut<'a, *mut ::ffi::$ffi_name> for $name {
            type Storage = &'a mut Self;

            #[inline]
            fn to_glib_none_mut(&'a mut self) -> StashMut<'a, *mut ::ffi::$ffi_name, Self> {
                let ptr = <$crate::Event as ToGlibPtrMut<*mut ::ffi::GdkEvent>>::to_glib_none_mut(
                    &mut *self,
                )
                .0;
                StashMut(ptr as *mut ::ffi::$ffi_name, self)
            }
        }

        impl FromGlibPtrNone<*mut ::ffi::$ffi_name> for $name {
            #[inline]
            unsafe fn from_glib_none(ptr: *mut ::ffi::$ffi_name) -> Self {
                <$name as crate::event::FromEvent>::from(from_glib_none(
                    ptr as *mut ::ffi::GdkEvent,
                ))
                .unwrap()
            }
        }

        impl FromGlibPtrBorrow<*mut ::ffi::$ffi_name> for $name {
            #[inline]
            unsafe fn from_glib_borrow(
                ptr: *mut ::ffi::$ffi_name,
            ) -> glib::translate::Borrowed<Self> {
                glib::translate::Borrowed::new(
                    <$name as crate::event::FromEvent>::from(
                        crate::Event::from_glib_borrow(ptr as *mut ::ffi::GdkEvent).into_inner(),
                    )
                    .map_err(std::mem::forget)
                    .unwrap(),
                )
            }
        }

        impl FromGlibPtrFull<*mut ::ffi::$ffi_name> for $name {
            #[inline]
            unsafe fn from_glib_full(ptr: *mut ::ffi::$ffi_name) -> Self {
                <$name as crate::event::FromEvent>::from(from_glib_full(
                    ptr as *mut ::ffi::GdkEvent,
                ))
                .unwrap()
            }
        }

        impl AsRef<::ffi::$ffi_name> for $name {
            #[inline]
            fn as_ref(&self) -> &::ffi::$ffi_name {
                unsafe {
                    let ptr: *const ::ffi::$ffi_name = self.to_glib_none().0;
                    &*ptr
                }
            }
        }

        impl AsMut<::ffi::$ffi_name> for $name {
            #[inline]
            fn as_mut(&mut self) -> &mut ::ffi::$ffi_name {
                unsafe {
                    let ptr: *mut ::ffi::$ffi_name = self.to_glib_none_mut().0;
                    &mut *ptr
                }
            }
        }
    };
}

event_wrapper!(Event, GdkEventAny);

macro_rules! event_subtype {
    ($name:ident, $($ty:path)|+) => {
        unsafe impl crate::event::FromEvent for $name {
            #[inline]
            fn is(ev: &crate::event::Event) -> bool {
                skip_assert_initialized!();
                matches!(ev.as_ref().type_, $($ty)|+)
            }

            #[inline]
            fn from(ev: crate::event::Event) -> Result<Self, crate::event::Event> {
                skip_assert_initialized!();
                if Self::is(&ev) {
                    Ok($name(ev))
                } else {
                    Err(ev)
                }
            }
        }

        impl ::std::ops::Deref for $name {
            type Target = crate::event::Event;

            fn deref(&self) -> &crate::event::Event {
                &self.0
            }
        }

        impl ::std::ops::DerefMut for $name {
            fn deref_mut(&mut self) -> &mut crate::event::Event {
                &mut self.0
            }
        }
    };
}

unsafe impl FromEvent for Event {
    #[inline]
    fn is(_ev: &Event) -> bool {
        skip_assert_initialized!();
        true
    }

    #[inline]
    fn from(ev: Event) -> Result<Self, Event> {
        skip_assert_initialized!();
        Ok(ev)
    }
}
