#![cfg_attr(docsrs, feature(doc_cfg))]

use gdk::{GdkAtom, GdkDevicePadFeature};
use glib::{gpointer, GType};
use libc::{c_char, c_int, c_uint};

macro_rules! opaque {
    ($(#[$attr:meta])*
     $name:ident) => {
        // https://doc.rust-lang.org/nomicon/ffi.html#representing-opaque-structs
        $(#[$attr])*
        #[repr(C)]
        pub struct $name {
            _data: [u8; 0],
            _marker: core::marker::PhantomData<(*mut u8, core::marker::PhantomPinned)>,
        }
        $(#[$attr])*
        impl ::std::fmt::Debug for $name {
            fn fmt(&self, f: &mut ::std::fmt::Formatter) -> ::std::fmt::Result {
                write!(f, "{} @ {:?}", stringify!($name), self as *const _)
            }
        }
    };
}

opaque!(GdkWaylandDevice);
opaque!(GdkWaylandDisplay);
opaque!(GdkWaylandGLContext);
opaque!(GdkWaylandMonitor);
opaque!(GdkWaylandWindow);
opaque!(GdkWaylandSeat);

extern "C" {
    //=========================================================================
    // GdkWaylandWindow
    //=========================================================================
    pub fn gdk_wayland_window_get_type() -> GType;

    pub fn gdk_wayland_window_get_wl_surface(window: *mut GdkWaylandWindow) -> gpointer;

    pub fn gdk_wayland_window_set_use_custom_surface(window: *mut GdkWaylandWindow);

    pub fn gdk_wayland_window_set_dbus_properties_libgtk_only(
        window: *mut GdkWaylandWindow,
        application_id: *const c_char,
        app_menu_path: *const c_char,
        menubar_path: *const c_char,
        window_object_path: *const c_char,
        application_object_path: *const c_char,
        unique_bus_name: *const c_char,
    );

    pub fn gdk_wayland_selection_add_targets(
        window: *mut GdkWaylandWindow,
        selection: GdkAtom,
        ntargets: c_uint,
        targets: *mut GdkAtom,
    );

    pub fn gdk_wayland_window_unexport_handle(window: *mut GdkWaylandWindow);

    pub fn gdk_wayland_window_export_handle(
        window: *mut GdkWaylandWindow,
        cb: Option<unsafe extern "C" fn(*mut GdkWaylandWindow, *const c_char, *mut libc::c_void)>,
        user_data: *mut libc::c_void,
        destroy_notify: Option<unsafe extern "C" fn(*mut libc::c_void)>,
    ) -> glib::gboolean;

    pub fn gdk_wayland_window_set_transient_for_exported(
        window: *mut GdkWaylandWindow,
        parent_handle: *const c_char,
    ) -> glib::gboolean;

    #[cfg(feature = "v3_24_22")]
    #[cfg_attr(docsrs, doc(cfg(feature = "v3_24_22")))]
    pub fn gdk_wayland_window_set_application_id(
        window: *mut GdkWaylandWindow,
        application_id: *const c_char,
    ) -> glib::gboolean;

    pub fn gdk_wayland_window_announce_csd(window: *mut GdkWaylandWindow);

    #[cfg(feature = "v3_24")]
    #[cfg_attr(docsrs, doc(cfg(feature = "v3_24")))]
    pub fn gdk_wayland_window_announce_ssd(window: *mut GdkWaylandWindow);

    #[cfg(feature = "v3_24")]
    #[cfg_attr(docsrs, doc(cfg(feature = "v3_24")))]
    pub fn gdk_wayland_window_add_frame_callback_surface(
        window: *mut GdkWaylandWindow,
        surface: glib::gconstpointer,
    );

    #[cfg(feature = "v3_24")]
    #[cfg_attr(docsrs, doc(cfg(feature = "v3_24")))]
    pub fn gdk_wayland_window_remove_frame_callback_surface(
        window: *mut GdkWaylandWindow,
        surface: glib::gconstpointer,
    );

    //=========================================================================
    // GdkWaylandDevice
    //=========================================================================
    pub fn gdk_wayland_device_get_type() -> GType;

    pub fn gdk_wayland_device_get_wl_seat(device: *mut GdkWaylandDevice) -> gpointer;

    pub fn gdk_wayland_device_get_wl_pointer(device: *mut GdkWaylandDevice) -> gpointer;

    pub fn gdk_wayland_device_get_wl_keyboard(device: *mut GdkWaylandDevice) -> gpointer;

    pub fn gdk_wayland_device_get_node_path(device: *mut GdkWaylandDevice) -> *const c_char;

    pub fn gdk_wayland_device_pad_set_feedback(
        device: *mut GdkWaylandDevice,
        element: GdkDevicePadFeature,
        idx: c_uint,
        label: *const c_char,
    );

    //=========================================================================
    // GdkWaylandDisplay
    //=========================================================================
    pub fn gdk_wayland_display_get_type() -> GType;

    pub fn gdk_wayland_display_set_cursor_theme(
        display: *mut GdkWaylandDisplay,
        theme: *const c_char,
        size: c_int,
    );

    pub fn gdk_wayland_display_get_wl_display(display: *mut GdkWaylandDisplay) -> gpointer;

    pub fn gdk_wayland_display_get_wl_compositor(display: *mut GdkWaylandDisplay) -> gpointer;

    pub fn gdk_wayland_display_set_startup_notification_id(
        display: *mut GdkWaylandDisplay,
        startup_id: *const c_char,
    );

    pub fn gdk_wayland_display_prefers_ssd(display: *mut GdkWaylandDisplay) -> glib::gboolean;

    pub fn gdk_wayland_display_query_registry(
        display: *mut GdkWaylandDisplay,
        global: *const c_char,
    ) -> glib::gboolean;

    //=========================================================================
    // GdkWaylandGLContext
    //=========================================================================
    pub fn gdk_wayland_gl_context_get_type() -> GType;

    //=========================================================================
    // GdkWaylandSeat
    //=========================================================================
    pub fn gdk_wayland_seat_get_type() -> GType;

    pub fn gdk_wayland_seat_get_wl_seat(seat: *mut GdkWaylandSeat) -> gpointer;

    //=========================================================================
    // GdkWaylandMonitor
    //=========================================================================
    pub fn gdk_wayland_monitor_get_type() -> GType;

    pub fn gdk_wayland_monitor_get_wl_output(monitor: *mut GdkWaylandMonitor) -> gpointer;
}
