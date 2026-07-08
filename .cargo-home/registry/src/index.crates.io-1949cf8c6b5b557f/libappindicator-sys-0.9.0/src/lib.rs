#![allow(non_upper_case_globals)]
#![allow(non_camel_case_types)]
#![allow(non_snake_case)]

use gtk_sys::{
  GtkContainer, GtkContainerPrivate, GtkMenu, GtkMenuPrivate, GtkMenuShell, GtkMenuShellPrivate,
  GtkStatusIconPrivate, GtkWidget, GtkWidgetPrivate,
};
use libloading::*;
use once_cell::sync::Lazy;
use std::os::raw::*;

pub static LIB: Lazy<Library> = Lazy::new(|| {
  let libayatana = unsafe { Library::new("libayatana-appindicator3.so.1") };
  if let Ok(lib) = libayatana {
    return lib;
  }

  let libappindicator = unsafe { Library::new("libappindicator3.so.1") };
  if let Ok(lib) = libappindicator {
    return lib;
  }

  // Versions v0.7.1 and v0.7.2 relied exclusively on the .so files without .1 suffix.
  // This is 'bad' because by convention that signals we don't care about ABI compatibility.
  // However in weird cases (*ahum* Tauri bundled appimages) this .so file is the only one
  // available. Using this feature flag allows them some time to fix this problem and bundle
  // with the correct filename.
  #[cfg(feature = "backcompat")]
  {
    let libayatana_compat = unsafe { Library::new("libayatana-appindicator3.so") };
    if let Ok(lib) = libayatana_compat {
      return lib;
    }

    let libappindicator_compat = unsafe { Library::new("libappindicator3.so") };
    if let Ok(lib) = libappindicator_compat {
      return lib;
    }

    panic!(
      "Failed to load ayatana-appindicator3 or appindicator3 dynamic library\n{}\n{}\n{}\n{}",
      libayatana.unwrap_err(),
      libappindicator.unwrap_err(),
      libayatana_compat.unwrap_err(),
      libappindicator_compat.unwrap_err(),
    );
  }

  panic!(
    "Failed to load ayatana-appindicator3 or appindicator3 dynamic library\n{}\n{}",
    libayatana.unwrap_err(),
    libappindicator.unwrap_err()
  );
});

pub type guint32 = c_uint;
pub type gint64 = c_long;
pub type guint64 = c_ulong;
pub type gsize = c_ulong;
pub type gchar = c_char;
pub type glong = c_long;
pub type gint = c_int;
pub type gboolean = gint;
pub type gulong = c_ulong;
pub type guint = c_uint;
pub type gfloat = f32;
pub type gdouble = f64;
pub type gpointer = *mut c_void;
#[repr(C)]
#[derive(Debug, Copy, Clone)]
pub struct _GData {
  _unused: [u8; 0],
}
pub type GData = _GData;
pub type GSList = _GSList;
#[repr(C)]
#[derive(Debug, Copy, Clone)]
pub struct _GSList {
  pub data: gpointer,
  pub next: *mut GSList,
}
#[test]
fn bindgen_test_layout__GSList() {
  assert_eq!(
    ::std::mem::size_of::<_GSList>(),
    16usize,
    concat!("Size of: ", stringify!(_GSList))
  );
  assert_eq!(
    ::std::mem::align_of::<_GSList>(),
    8usize,
    concat!("Alignment of ", stringify!(_GSList))
  );
  assert_eq!(
    unsafe { &(*(::std::ptr::null::<_GSList>())).data as *const _ as usize },
    0usize,
    concat!(
      "Offset of field: ",
      stringify!(_GSList),
      "::",
      stringify!(data)
    )
  );
  assert_eq!(
    unsafe { &(*(::std::ptr::null::<_GSList>())).next as *const _ as usize },
    8usize,
    concat!(
      "Offset of field: ",
      stringify!(_GSList),
      "::",
      stringify!(next)
    )
  );
}
pub type GType = gsize;
pub type GValue = _GValue;
pub type GTypeClass = _GTypeClass;
pub type GTypeInstance = _GTypeInstance;
#[doc = " GTypeClass:"]
#[doc = ""]
#[doc = " An opaque structure used as the base of all classes."]
#[repr(C)]
#[derive(Debug, Copy, Clone)]
pub struct _GTypeClass {
  pub g_type: GType,
}
#[test]
fn bindgen_test_layout__GTypeClass() {
  assert_eq!(
    ::std::mem::size_of::<_GTypeClass>(),
    8usize,
    concat!("Size of: ", stringify!(_GTypeClass))
  );
  assert_eq!(
    ::std::mem::align_of::<_GTypeClass>(),
    8usize,
    concat!("Alignment of ", stringify!(_GTypeClass))
  );
  assert_eq!(
    unsafe { &(*(::std::ptr::null::<_GTypeClass>())).g_type as *const _ as usize },
    0usize,
    concat!(
      "Offset of field: ",
      stringify!(_GTypeClass),
      "::",
      stringify!(g_type)
    )
  );
}
#[doc = " GTypeInstance:"]
#[doc = ""]
#[doc = " An opaque structure used as the base of all type instances."]
#[repr(C)]
#[derive(Debug, Copy, Clone)]
pub struct _GTypeInstance {
  pub g_class: *mut GTypeClass,
}
#[test]
fn bindgen_test_layout__GTypeInstance() {
  assert_eq!(
    ::std::mem::size_of::<_GTypeInstance>(),
    8usize,
    concat!("Size of: ", stringify!(_GTypeInstance))
  );
  assert_eq!(
    ::std::mem::align_of::<_GTypeInstance>(),
    8usize,
    concat!("Alignment of ", stringify!(_GTypeInstance))
  );
  assert_eq!(
    unsafe { &(*(::std::ptr::null::<_GTypeInstance>())).g_class as *const _ as usize },
    0usize,
    concat!(
      "Offset of field: ",
      stringify!(_GTypeInstance),
      "::",
      stringify!(g_class)
    )
  );
}
#[doc = " GValue:"]
#[doc = ""]
#[doc = " An opaque structure used to hold different types of values."]
#[doc = " The data within the structure has protected scope: it is accessible only"]
#[doc = " to functions within a #GTypeValueTable structure, or implementations of"]
#[doc = " the g_value_*() API. That is, code portions which implement new fundamental"]
#[doc = " types."]
#[doc = " #GValue users cannot make any assumptions about how data is stored"]
#[doc = " within the 2 element @data union, and the @g_type member should"]
#[doc = " only be accessed through the G_VALUE_TYPE() macro."]
#[repr(C)]
#[derive(Copy, Clone)]
pub struct _GValue {
  pub g_type: GType,
  pub data: [_GValue__bindgen_ty_1; 2usize],
}
#[repr(C)]
#[derive(Copy, Clone)]
pub union _GValue__bindgen_ty_1 {
  pub v_int: gint,
  pub v_uint: guint,
  pub v_long: glong,
  pub v_ulong: gulong,
  pub v_int64: gint64,
  pub v_uint64: guint64,
  pub v_float: gfloat,
  pub v_double: gdouble,
  pub v_pointer: gpointer,
  _bindgen_union_align: u64,
}
#[test]
fn bindgen_test_layout__GValue__bindgen_ty_1() {
  assert_eq!(
    ::std::mem::size_of::<_GValue__bindgen_ty_1>(),
    8usize,
    concat!("Size of: ", stringify!(_GValue__bindgen_ty_1))
  );
  assert_eq!(
    ::std::mem::align_of::<_GValue__bindgen_ty_1>(),
    8usize,
    concat!("Alignment of ", stringify!(_GValue__bindgen_ty_1))
  );
  assert_eq!(
    unsafe { &(*(::std::ptr::null::<_GValue__bindgen_ty_1>())).v_int as *const _ as usize },
    0usize,
    concat!(
      "Offset of field: ",
      stringify!(_GValue__bindgen_ty_1),
      "::",
      stringify!(v_int)
    )
  );
  assert_eq!(
    unsafe { &(*(::std::ptr::null::<_GValue__bindgen_ty_1>())).v_uint as *const _ as usize },
    0usize,
    concat!(
      "Offset of field: ",
      stringify!(_GValue__bindgen_ty_1),
      "::",
      stringify!(v_uint)
    )
  );
  assert_eq!(
    unsafe { &(*(::std::ptr::null::<_GValue__bindgen_ty_1>())).v_long as *const _ as usize },
    0usize,
    concat!(
      "Offset of field: ",
      stringify!(_GValue__bindgen_ty_1),
      "::",
      stringify!(v_long)
    )
  );
  assert_eq!(
    unsafe { &(*(::std::ptr::null::<_GValue__bindgen_ty_1>())).v_ulong as *const _ as usize },
    0usize,
    concat!(
      "Offset of field: ",
      stringify!(_GValue__bindgen_ty_1),
      "::",
      stringify!(v_ulong)
    )
  );
  assert_eq!(
    unsafe { &(*(::std::ptr::null::<_GValue__bindgen_ty_1>())).v_int64 as *const _ as usize },
    0usize,
    concat!(
      "Offset of field: ",
      stringify!(_GValue__bindgen_ty_1),
      "::",
      stringify!(v_int64)
    )
  );
  assert_eq!(
    unsafe { &(*(::std::ptr::null::<_GValue__bindgen_ty_1>())).v_uint64 as *const _ as usize },
    0usize,
    concat!(
      "Offset of field: ",
      stringify!(_GValue__bindgen_ty_1),
      "::",
      stringify!(v_uint64)
    )
  );
  assert_eq!(
    unsafe { &(*(::std::ptr::null::<_GValue__bindgen_ty_1>())).v_float as *const _ as usize },
    0usize,
    concat!(
      "Offset of field: ",
      stringify!(_GValue__bindgen_ty_1),
      "::",
      stringify!(v_float)
    )
  );
  assert_eq!(
    unsafe { &(*(::std::ptr::null::<_GValue__bindgen_ty_1>())).v_double as *const _ as usize },
    0usize,
    concat!(
      "Offset of field: ",
      stringify!(_GValue__bindgen_ty_1),
      "::",
      stringify!(v_double)
    )
  );
  assert_eq!(
    unsafe { &(*(::std::ptr::null::<_GValue__bindgen_ty_1>())).v_pointer as *const _ as usize },
    0usize,
    concat!(
      "Offset of field: ",
      stringify!(_GValue__bindgen_ty_1),
      "::",
      stringify!(v_pointer)
    )
  );
}
#[test]
fn bindgen_test_layout__GValue() {
  assert_eq!(
    ::std::mem::size_of::<_GValue>(),
    24usize,
    concat!("Size of: ", stringify!(_GValue))
  );
  assert_eq!(
    ::std::mem::align_of::<_GValue>(),
    8usize,
    concat!("Alignment of ", stringify!(_GValue))
  );
  assert_eq!(
    unsafe { &(*(::std::ptr::null::<_GValue>())).g_type as *const _ as usize },
    0usize,
    concat!(
      "Offset of field: ",
      stringify!(_GValue),
      "::",
      stringify!(g_type)
    )
  );
  assert_eq!(
    unsafe { &(*(::std::ptr::null::<_GValue>())).data as *const _ as usize },
    8usize,
    concat!(
      "Offset of field: ",
      stringify!(_GValue),
      "::",
      stringify!(data)
    )
  );
}
pub const GParamFlags_G_PARAM_READABLE: GParamFlags = 1;
pub const GParamFlags_G_PARAM_WRITABLE: GParamFlags = 2;
pub const GParamFlags_G_PARAM_READWRITE: GParamFlags = 3;
pub const GParamFlags_G_PARAM_CONSTRUCT: GParamFlags = 4;
pub const GParamFlags_G_PARAM_CONSTRUCT_ONLY: GParamFlags = 8;
pub const GParamFlags_G_PARAM_LAX_VALIDATION: GParamFlags = 16;
pub const GParamFlags_G_PARAM_STATIC_NAME: GParamFlags = 32;
pub const GParamFlags_G_PARAM_PRIVATE: GParamFlags = 32;
pub const GParamFlags_G_PARAM_STATIC_NICK: GParamFlags = 64;
pub const GParamFlags_G_PARAM_STATIC_BLURB: GParamFlags = 128;
pub const GParamFlags_G_PARAM_EXPLICIT_NOTIFY: GParamFlags = 1073741824;
pub const GParamFlags_G_PARAM_DEPRECATED: GParamFlags = -2147483648;
#[doc = " GParamFlags:"]
#[doc = " @G_PARAM_READABLE: the parameter is readable"]
#[doc = " @G_PARAM_WRITABLE: the parameter is writable"]
#[doc = " @G_PARAM_READWRITE: alias for %G_PARAM_READABLE | %G_PARAM_WRITABLE"]
#[doc = " @G_PARAM_CONSTRUCT: the parameter will be set upon object construction"]
#[doc = " @G_PARAM_CONSTRUCT_ONLY: the parameter can only be set upon object construction"]
#[doc = " @G_PARAM_LAX_VALIDATION: upon parameter conversion (see g_param_value_convert())"]
#[doc = "  strict validation is not required"]
#[doc = " @G_PARAM_STATIC_NAME: the string used as name when constructing the"]
#[doc = "  parameter is guaranteed to remain valid and"]
#[doc = "  unmodified for the lifetime of the parameter."]
#[doc = "  Since 2.8"]
#[doc = " @G_PARAM_STATIC_NICK: the string used as nick when constructing the"]
#[doc = "  parameter is guaranteed to remain valid and"]
#[doc = "  unmmodified for the lifetime of the parameter."]
#[doc = "  Since 2.8"]
#[doc = " @G_PARAM_STATIC_BLURB: the string used as blurb when constructing the"]
#[doc = "  parameter is guaranteed to remain valid and"]
#[doc = "  unmodified for the lifetime of the parameter."]
#[doc = "  Since 2.8"]
#[doc = " @G_PARAM_EXPLICIT_NOTIFY: calls to g_object_set_property() for this"]
#[doc = "   property will not automatically result in a \"notify\" signal being"]
#[doc = "   emitted: the implementation must call g_object_notify() themselves"]
#[doc = "   in case the property actually changes.  Since: 2.42."]
#[doc = " @G_PARAM_PRIVATE: internal"]
#[doc = " @G_PARAM_DEPRECATED: the parameter is deprecated and will be removed"]
#[doc = "  in a future version. A warning will be generated if it is used"]
#[doc = "  while running with G_ENABLE_DIAGNOSTIC=1."]
#[doc = "  Since 2.26"]
#[doc = ""]
#[doc = " Through the #GParamFlags flag values, certain aspects of parameters"]
#[doc = " can be configured. See also #G_PARAM_STATIC_STRINGS."]
pub type GParamFlags = i32;
pub type GParamSpec = _GParamSpec;
#[doc = " GParamSpec: (ref-func g_param_spec_ref_sink) (unref-func g_param_spec_uref) (set-value-func g_value_set_param) (get-value-func g_value_get_param)"]
#[doc = " @g_type_instance: private #GTypeInstance portion"]
#[doc = " @name: name of this parameter: always an interned string"]
#[doc = " @flags: #GParamFlags flags for this parameter"]
#[doc = " @value_type: the #GValue type for this parameter"]
#[doc = " @owner_type: #GType type that uses (introduces) this parameter"]
#[doc = ""]
#[doc = " All other fields of the GParamSpec struct are private and"]
#[doc = " should not be used directly."]
#[repr(C)]
#[derive(Debug, Copy, Clone)]
pub struct _GParamSpec {
  pub g_type_instance: GTypeInstance,
  pub name: *const gchar,
  pub flags: GParamFlags,
  pub value_type: GType,
  pub owner_type: GType,
  pub _nick: *mut gchar,
  pub _blurb: *mut gchar,
  pub qdata: *mut GData,
  pub ref_count: guint,
  pub param_id: guint,
}
#[test]
fn bindgen_test_layout__GParamSpec() {
  assert_eq!(
    ::std::mem::size_of::<_GParamSpec>(),
    72usize,
    concat!("Size of: ", stringify!(_GParamSpec))
  );
  assert_eq!(
    ::std::mem::align_of::<_GParamSpec>(),
    8usize,
    concat!("Alignment of ", stringify!(_GParamSpec))
  );
  assert_eq!(
    unsafe { &(*(::std::ptr::null::<_GParamSpec>())).g_type_instance as *const _ as usize },
    0usize,
    concat!(
      "Offset of field: ",
      stringify!(_GParamSpec),
      "::",
      stringify!(g_type_instance)
    )
  );
  assert_eq!(
    unsafe { &(*(::std::ptr::null::<_GParamSpec>())).name as *const _ as usize },
    8usize,
    concat!(
      "Offset of field: ",
      stringify!(_GParamSpec),
      "::",
      stringify!(name)
    )
  );
  assert_eq!(
    unsafe { &(*(::std::ptr::null::<_GParamSpec>())).flags as *const _ as usize },
    16usize,
    concat!(
      "Offset of field: ",
      stringify!(_GParamSpec),
      "::",
      stringify!(flags)
    )
  );
  assert_eq!(
    unsafe { &(*(::std::ptr::null::<_GParamSpec>())).value_type as *const _ as usize },
    24usize,
    concat!(
      "Offset of field: ",
      stringify!(_GParamSpec),
      "::",
      stringify!(value_type)
    )
  );
  assert_eq!(
    unsafe { &(*(::std::ptr::null::<_GParamSpec>())).owner_type as *const _ as usize },
    32usize,
    concat!(
      "Offset of field: ",
      stringify!(_GParamSpec),
      "::",
      stringify!(owner_type)
    )
  );
  assert_eq!(
    unsafe { &(*(::std::ptr::null::<_GParamSpec>()))._nick as *const _ as usize },
    40usize,
    concat!(
      "Offset of field: ",
      stringify!(_GParamSpec),
      "::",
      stringify!(_nick)
    )
  );
  assert_eq!(
    unsafe { &(*(::std::ptr::null::<_GParamSpec>()))._blurb as *const _ as usize },
    48usize,
    concat!(
      "Offset of field: ",
      stringify!(_GParamSpec),
      "::",
      stringify!(_blurb)
    )
  );
  assert_eq!(
    unsafe { &(*(::std::ptr::null::<_GParamSpec>())).qdata as *const _ as usize },
    56usize,
    concat!(
      "Offset of field: ",
      stringify!(_GParamSpec),
      "::",
      stringify!(qdata)
    )
  );
  assert_eq!(
    unsafe { &(*(::std::ptr::null::<_GParamSpec>())).ref_count as *const _ as usize },
    64usize,
    concat!(
      "Offset of field: ",
      stringify!(_GParamSpec),
      "::",
      stringify!(ref_count)
    )
  );
  assert_eq!(
    unsafe { &(*(::std::ptr::null::<_GParamSpec>())).param_id as *const _ as usize },
    68usize,
    concat!(
      "Offset of field: ",
      stringify!(_GParamSpec),
      "::",
      stringify!(param_id)
    )
  );
}
pub type GObject = _GObject;
pub type GInitiallyUnowned = _GObject;
#[doc = " GObject:"]
#[doc = ""]
#[doc = " All the fields in the GObject structure are private"]
#[doc = " to the #GObject implementation and should never be accessed directly."]
#[repr(C)]
#[derive(Debug, Copy, Clone)]
pub struct _GObject {
  pub g_type_instance: GTypeInstance,
  pub ref_count: guint,
  pub qdata: *mut GData,
}
#[test]
fn bindgen_test_layout__GObject() {
  assert_eq!(
    ::std::mem::size_of::<_GObject>(),
    24usize,
    concat!("Size of: ", stringify!(_GObject))
  );
  assert_eq!(
    ::std::mem::align_of::<_GObject>(),
    8usize,
    concat!("Alignment of ", stringify!(_GObject))
  );
  assert_eq!(
    unsafe { &(*(::std::ptr::null::<_GObject>())).g_type_instance as *const _ as usize },
    0usize,
    concat!(
      "Offset of field: ",
      stringify!(_GObject),
      "::",
      stringify!(g_type_instance)
    )
  );
  assert_eq!(
    unsafe { &(*(::std::ptr::null::<_GObject>())).ref_count as *const _ as usize },
    8usize,
    concat!(
      "Offset of field: ",
      stringify!(_GObject),
      "::",
      stringify!(ref_count)
    )
  );
  assert_eq!(
    unsafe { &(*(::std::ptr::null::<_GObject>())).qdata as *const _ as usize },
    16usize,
    concat!(
      "Offset of field: ",
      stringify!(_GObject),
      "::",
      stringify!(qdata)
    )
  );
}
pub const GdkScrollDirection_GDK_SCROLL_UP: GdkScrollDirection = 0;
pub const GdkScrollDirection_GDK_SCROLL_DOWN: GdkScrollDirection = 1;
pub const GdkScrollDirection_GDK_SCROLL_LEFT: GdkScrollDirection = 2;
pub const GdkScrollDirection_GDK_SCROLL_RIGHT: GdkScrollDirection = 3;
pub const GdkScrollDirection_GDK_SCROLL_SMOOTH: GdkScrollDirection = 4;
#[doc = " GdkScrollDirection:"]
#[doc = " @GDK_SCROLL_UP: the window is scrolled up."]
#[doc = " @GDK_SCROLL_DOWN: the window is scrolled down."]
#[doc = " @GDK_SCROLL_LEFT: the window is scrolled to the left."]
#[doc = " @GDK_SCROLL_RIGHT: the window is scrolled to the right."]
#[doc = " @GDK_SCROLL_SMOOTH: the scrolling is determined by the delta values"]
#[doc = "   in #GdkEventScroll. See gdk_event_get_scroll_deltas(). Since: 3.4"]
#[doc = ""]
#[doc = " Specifies the direction for #GdkEventScroll."]
pub type GdkScrollDirection = u32;
#[repr(C)]
#[derive(Debug, Copy, Clone)]
pub struct _GtkWidgetPrivate {
  _unused: [u8; 0],
}
#[repr(C)]
#[derive(Debug, Copy, Clone)]
pub struct _GtkWidget {
  pub parent_instance: GInitiallyUnowned,
  pub priv_: *mut GtkWidgetPrivate,
}
#[test]
fn bindgen_test_layout__GtkWidget() {
  assert_eq!(
    ::std::mem::size_of::<_GtkWidget>(),
    32usize,
    concat!("Size of: ", stringify!(_GtkWidget))
  );
  assert_eq!(
    ::std::mem::align_of::<_GtkWidget>(),
    8usize,
    concat!("Alignment of ", stringify!(_GtkWidget))
  );
  assert_eq!(
    unsafe { &(*(::std::ptr::null::<_GtkWidget>())).parent_instance as *const _ as usize },
    0usize,
    concat!(
      "Offset of field: ",
      stringify!(_GtkWidget),
      "::",
      stringify!(parent_instance)
    )
  );
  assert_eq!(
    unsafe { &(*(::std::ptr::null::<_GtkWidget>())).priv_ as *const _ as usize },
    24usize,
    concat!(
      "Offset of field: ",
      stringify!(_GtkWidget),
      "::",
      stringify!(priv_)
    )
  );
}
#[repr(C)]
#[derive(Debug, Copy, Clone)]
pub struct _GtkContainerPrivate {
  _unused: [u8; 0],
}
#[repr(C)]
pub struct _GtkContainer {
  pub widget: GtkWidget,
  pub priv_: *mut GtkContainerPrivate,
}
#[test]
fn bindgen_test_layout__GtkContainer() {
  assert_eq!(
    ::std::mem::size_of::<_GtkContainer>(),
    40usize,
    concat!("Size of: ", stringify!(_GtkContainer))
  );
  assert_eq!(
    ::std::mem::align_of::<_GtkContainer>(),
    8usize,
    concat!("Alignment of ", stringify!(_GtkContainer))
  );
  assert_eq!(
    unsafe { &(*(::std::ptr::null::<_GtkContainer>())).widget as *const _ as usize },
    0usize,
    concat!(
      "Offset of field: ",
      stringify!(_GtkContainer),
      "::",
      stringify!(widget)
    )
  );
  assert_eq!(
    unsafe { &(*(::std::ptr::null::<_GtkContainer>())).priv_ as *const _ as usize },
    32usize,
    concat!(
      "Offset of field: ",
      stringify!(_GtkContainer),
      "::",
      stringify!(priv_)
    )
  );
}
#[repr(C)]
#[derive(Debug, Copy, Clone)]
pub struct _GtkMenuShellPrivate {
  _unused: [u8; 0],
}
#[repr(C)]
pub struct _GtkMenuShell {
  pub container: GtkContainer,
  pub priv_: *mut GtkMenuShellPrivate,
}
#[test]
fn bindgen_test_layout__GtkMenuShell() {
  assert_eq!(
    ::std::mem::size_of::<_GtkMenuShell>(),
    48usize,
    concat!("Size of: ", stringify!(_GtkMenuShell))
  );
  assert_eq!(
    ::std::mem::align_of::<_GtkMenuShell>(),
    8usize,
    concat!("Alignment of ", stringify!(_GtkMenuShell))
  );
  assert_eq!(
    unsafe { &(*(::std::ptr::null::<_GtkMenuShell>())).container as *const _ as usize },
    0usize,
    concat!(
      "Offset of field: ",
      stringify!(_GtkMenuShell),
      "::",
      stringify!(container)
    )
  );
  assert_eq!(
    unsafe { &(*(::std::ptr::null::<_GtkMenuShell>())).priv_ as *const _ as usize },
    40usize,
    concat!(
      "Offset of field: ",
      stringify!(_GtkMenuShell),
      "::",
      stringify!(priv_)
    )
  );
}
#[repr(C)]
#[derive(Debug, Copy, Clone)]
pub struct _GtkMenuPrivate {
  _unused: [u8; 0],
}
#[repr(C)]
pub struct _GtkMenu {
  pub menu_shell: GtkMenuShell,
  pub priv_: *mut GtkMenuPrivate,
}
#[test]
fn bindgen_test_layout__GtkMenu() {
  assert_eq!(
    ::std::mem::size_of::<_GtkMenu>(),
    56usize,
    concat!("Size of: ", stringify!(_GtkMenu))
  );
  assert_eq!(
    ::std::mem::align_of::<_GtkMenu>(),
    8usize,
    concat!("Alignment of ", stringify!(_GtkMenu))
  );
  assert_eq!(
    unsafe { &(*(::std::ptr::null::<_GtkMenu>())).menu_shell as *const _ as usize },
    0usize,
    concat!(
      "Offset of field: ",
      stringify!(_GtkMenu),
      "::",
      stringify!(menu_shell)
    )
  );
  assert_eq!(
    unsafe { &(*(::std::ptr::null::<_GtkMenu>())).priv_ as *const _ as usize },
    48usize,
    concat!(
      "Offset of field: ",
      stringify!(_GtkMenu),
      "::",
      stringify!(priv_)
    )
  );
}
#[repr(C)]
#[derive(Debug, Copy, Clone)]
pub struct _GtkStatusIconPrivate {
  _unused: [u8; 0],
}
#[repr(C)]
#[derive(Debug, Copy, Clone)]
pub struct _GtkStatusIcon {
  pub parent_instance: GObject,
  pub priv_: *mut GtkStatusIconPrivate,
}
#[test]
fn bindgen_test_layout__GtkStatusIcon() {
  assert_eq!(
    ::std::mem::size_of::<_GtkStatusIcon>(),
    32usize,
    concat!("Size of: ", stringify!(_GtkStatusIcon))
  );
  assert_eq!(
    ::std::mem::align_of::<_GtkStatusIcon>(),
    8usize,
    concat!("Alignment of ", stringify!(_GtkStatusIcon))
  );
  assert_eq!(
    unsafe { &(*(::std::ptr::null::<_GtkStatusIcon>())).parent_instance as *const _ as usize },
    0usize,
    concat!(
      "Offset of field: ",
      stringify!(_GtkStatusIcon),
      "::",
      stringify!(parent_instance)
    )
  );
  assert_eq!(
    unsafe { &(*(::std::ptr::null::<_GtkStatusIcon>())).priv_ as *const _ as usize },
    24usize,
    concat!(
      "Offset of field: ",
      stringify!(_GtkStatusIcon),
      "::",
      stringify!(priv_)
    )
  );
}
pub const AppIndicatorCategory_APP_INDICATOR_CATEGORY_APPLICATION_STATUS: AppIndicatorCategory = 0;
pub const AppIndicatorCategory_APP_INDICATOR_CATEGORY_COMMUNICATIONS: AppIndicatorCategory = 1;
pub const AppIndicatorCategory_APP_INDICATOR_CATEGORY_SYSTEM_SERVICES: AppIndicatorCategory = 2;
pub const AppIndicatorCategory_APP_INDICATOR_CATEGORY_HARDWARE: AppIndicatorCategory = 3;
pub const AppIndicatorCategory_APP_INDICATOR_CATEGORY_OTHER: AppIndicatorCategory = 4;
#[doc = " AppIndicatorCategory:"]
#[doc = " @APP_INDICATOR_CATEGORY_APPLICATION_STATUS: The indicator is used to display the status of the application."]
#[doc = " @APP_INDICATOR_CATEGORY_COMMUNICATIONS: The application is used for communication with other people."]
#[doc = " @APP_INDICATOR_CATEGORY_SYSTEM_SERVICES: A system indicator relating to something in the user's system."]
#[doc = " @APP_INDICATOR_CATEGORY_HARDWARE: An indicator relating to the user's hardware."]
#[doc = " @APP_INDICATOR_CATEGORY_OTHER: Something not defined in this enum, please don't use unless you really need it."]
#[doc = ""]
#[doc = " The category provides grouping for the indicators so that"]
#[doc = " users can find indicators that are similar together."]
pub type AppIndicatorCategory = u32;
pub const AppIndicatorStatus_APP_INDICATOR_STATUS_PASSIVE: AppIndicatorStatus = 0;
pub const AppIndicatorStatus_APP_INDICATOR_STATUS_ACTIVE: AppIndicatorStatus = 1;
pub const AppIndicatorStatus_APP_INDICATOR_STATUS_ATTENTION: AppIndicatorStatus = 2;
#[doc = " AppIndicatorStatus:"]
#[doc = " @APP_INDICATOR_STATUS_PASSIVE: The indicator should not be shown to the user."]
#[doc = " @APP_INDICATOR_STATUS_ACTIVE: The indicator should be shown in it's default state."]
#[doc = " @APP_INDICATOR_STATUS_ATTENTION: The indicator should show it's attention icon."]
#[doc = ""]
#[doc = " These are the states that the indicator can be on in"]
#[doc = " the user's panel.  The indicator by default starts"]
#[doc = " in the state @APP_INDICATOR_STATUS_PASSIVE and can be"]
#[doc = " shown by setting it to @APP_INDICATOR_STATUS_ACTIVE."]
pub type AppIndicatorStatus = u32;
pub type AppIndicator = _AppIndicator;
#[repr(C)]
#[derive(Debug, Copy, Clone)]
pub struct _AppIndicatorPrivate {
  _unused: [u8; 0],
}
pub type AppIndicatorPrivate = _AppIndicatorPrivate;
#[doc = " AppIndicator:"]
#[doc = ""]
#[doc = " A application indicator represents the values that are needed to show a"]
#[doc = " unique status in the panel for an application.  In general, applications"]
#[doc = " should try to fit in the other indicators that are available on the"]
#[doc = " panel before using this.  But, sometimes it is necissary."]
#[doc = ""]
#[doc = "  Private fields"]
#[doc = " @parent: Parent object."]
#[doc = " @priv: Internal data."]
#[repr(C)]
#[derive(Debug, Copy, Clone)]
pub struct _AppIndicator {
  pub parent: GObject,
  pub priv_: *mut AppIndicatorPrivate,
}
#[test]
fn bindgen_test_layout__AppIndicator() {
  assert_eq!(
    ::std::mem::size_of::<_AppIndicator>(),
    32usize,
    concat!("Size of: ", stringify!(_AppIndicator))
  );
  assert_eq!(
    ::std::mem::align_of::<_AppIndicator>(),
    8usize,
    concat!("Alignment of ", stringify!(_AppIndicator))
  );
  assert_eq!(
    unsafe { &(*(::std::ptr::null::<_AppIndicator>())).parent as *const _ as usize },
    0usize,
    concat!(
      "Offset of field: ",
      stringify!(_AppIndicator),
      "::",
      stringify!(parent)
    )
  );
  assert_eq!(
    unsafe { &(*(::std::ptr::null::<_AppIndicator>())).priv_ as *const _ as usize },
    24usize,
    concat!(
      "Offset of field: ",
      stringify!(_AppIndicator),
      "::",
      stringify!(priv_)
    )
  );
}

pub unsafe fn app_indicator_get_type() -> GType {
  let f = LIB
    .get::<unsafe extern "C" fn() -> GType>(b"app_indicator_get_type\0")
    .expect(
      "Can't get the extern function. This shouldn't happen unless the linked library is wrong.",
    );
  f()
}

// TODO use OnceCell to store symbols.
pub unsafe fn app_indicator_new(
  id: *const gchar,
  icon_name: *const gchar,
  category: AppIndicatorCategory,
) -> *mut AppIndicator {
  let f = LIB.get::<unsafe extern fn(*const gchar, *const gchar, AppIndicatorCategory) -> *mut AppIndicator>(b"app_indicator_new\0")
        .expect("Can't get the extern function. This shouldn't happen unless the linked library is wrong.");
  f(id, icon_name, category)
}

pub unsafe fn app_indicator_new_with_path(
  id: *const gchar,
  icon_name: *const gchar,
  category: AppIndicatorCategory,
  icon_theme_path: *const gchar,
) -> *mut AppIndicator {
  let f = LIB
    .get::<unsafe extern "C" fn(
      *const gchar,
      *const gchar,
      AppIndicatorCategory,
      *const gchar,
    ) -> *mut AppIndicator>(b"app_indicator_new_with_path\0")
    .expect(
      "Can't get the extern function. This shouldn't happen unless the linked library is wrong.",
    );
  f(id, icon_name, category, icon_theme_path)
}

pub unsafe fn app_indicator_set_status(self_: *mut AppIndicator, status: AppIndicatorStatus) {
  let f = LIB
    .get::<unsafe extern "C" fn(*mut AppIndicator, AppIndicatorStatus)>(
      b"app_indicator_set_status\0",
    )
    .expect(
      "Can't get the extern function. This shouldn't happen unless the linked library is wrong.",
    );
  f(self_, status)
}

pub unsafe fn app_indicator_set_attention_icon(self_: *mut AppIndicator, icon_name: *const gchar) {
  let f = LIB
    .get::<unsafe extern "C" fn(*mut AppIndicator, *const gchar)>(
      b"app_indicator_set_attention_icon\0",
    )
    .expect(
      "Can't get the extern function. This shouldn't happen unless the linked library is wrong.",
    );
  f(self_, icon_name)
}

pub unsafe fn app_indicator_set_attention_icon_full(
  self_: *mut AppIndicator,
  icon_name: *const gchar,
  icon_desc: *const gchar,
) {
  let f = LIB
    .get::<unsafe extern "C" fn(*mut AppIndicator, *const gchar, *const gchar)>(
      b"app_indicator_set_attention_icon_full\0",
    )
    .expect(
      "Can't get the extern function. This shouldn't happen unless the linked library is wrong.",
    );
  f(self_, icon_name, icon_desc)
}

pub unsafe fn app_indicator_set_menu(self_: *mut AppIndicator, menu: *mut GtkMenu) {
  let f = LIB
    .get::<unsafe extern "C" fn(*mut AppIndicator, *mut GtkMenu)>(b"app_indicator_set_menu\0")
    .expect(
      "Can't get the extern function. This shouldn't happen unless the linked library is wrong.",
    );
  f(self_, menu)
}

pub unsafe fn app_indicator_set_icon(self_: *mut AppIndicator, icon_name: *const gchar) {
  let f = LIB
    .get::<unsafe extern "C" fn(*mut AppIndicator, *const gchar)>(b"app_indicator_set_icon\0")
    .expect(
      "Can't get the extern function. This shouldn't happen unless the linked library is wrong.",
    );
  f(self_, icon_name)
}
pub unsafe fn app_indicator_set_icon_full(
  self_: *mut AppIndicator,
  icon_name: *const gchar,
  icon_desc: *const gchar,
) {
  let f = LIB
    .get::<unsafe extern "C" fn(*mut AppIndicator, *const gchar, *const gchar)>(
      b"app_indicator_set_icon_full\0",
    )
    .expect(
      "Can't get the extern function. This shouldn't happen unless the linked library is wrong.",
    );
  f(self_, icon_name, icon_desc)
}

pub unsafe fn app_indicator_set_label(
  self_: *mut AppIndicator,
  label: *const gchar,
  guide: *const gchar,
) {
  let f = LIB
    .get::<unsafe extern "C" fn(*mut AppIndicator, *const gchar, *const gchar)>(
      b"app_indicator_set_label\0",
    )
    .expect(
      "Can't get the extern function. This shouldn't happen unless the linked library is wrong.",
    );
  f(self_, label, guide)
}

pub unsafe fn app_indicator_set_icon_theme_path(
  self_: *mut AppIndicator,
  icon_theme_path: *const gchar,
) {
  let f = LIB
    .get::<unsafe extern "C" fn(*mut AppIndicator, *const gchar)>(
      b"app_indicator_set_icon_theme_path\0",
    )
    .expect(
      "Can't get the extern function. This shouldn't happen unless the linked library is wrong.",
    );
  f(self_, icon_theme_path)
}

pub unsafe fn app_indicator_set_ordering_index(self_: *mut AppIndicator, ordering_index: guint32) {
  let f = LIB
    .get::<unsafe extern "C" fn(*mut AppIndicator, guint32)>(b"app_indicator_set_ordering_index\0")
    .expect(
      "Can't get the extern function. This shouldn't happen unless the linked library is wrong.",
    );
  f(self_, ordering_index)
}

pub unsafe fn app_indicator_set_secondary_activate_target(
  self_: *mut AppIndicator,
  menuitem: *mut GtkWidget,
) {
  let f = LIB
    .get::<unsafe extern "C" fn(*mut AppIndicator, *mut GtkWidget)>(
      b"app_indicator_set_secondary_activate_target\0",
    )
    .expect(
      "Can't get the extern function. This shouldn't happen unless the linked library is wrong.",
    );
  f(self_, menuitem)
}

pub unsafe fn app_indicator_set_title(self_: *mut AppIndicator, title: *const gchar) {
  let f = LIB
    .get::<unsafe extern "C" fn(*mut AppIndicator, *const gchar)>(b"app_indicator_set_title\0")
    .expect(
      "Can't get the extern function. This shouldn't happen unless the linked library is wrong.",
    );
  f(self_, title)
}

pub unsafe fn app_indicator_get_id(self_: *mut AppIndicator) -> *const gchar {
  let f = LIB
    .get::<unsafe extern "C" fn(*mut AppIndicator) -> *const gchar>(b"app_indicator_get_id\0")
    .expect(
      "Can't get the extern function. This shouldn't happen unless the linked library is wrong.",
    );
  f(self_)
}

pub unsafe fn app_indicator_get_category(self_: *mut AppIndicator) -> AppIndicatorCategory {
  let f = LIB
    .get::<unsafe extern "C" fn(*mut AppIndicator) -> AppIndicatorCategory>(
      b"app_indicator_get_category\0",
    )
    .expect(
      "Can't get the extern function. This shouldn't happen unless the linked library is wrong.",
    );
  f(self_)
}

pub unsafe fn app_indicator_get_status(self_: *mut AppIndicator) -> AppIndicatorStatus {
  let f = LIB
    .get::<unsafe extern "C" fn(*mut AppIndicator) -> AppIndicatorStatus>(
      b"app_indicator_get_status\0",
    )
    .expect(
      "Can't get the extern function. This shouldn't happen unless the linked library is wrong.",
    );
  f(self_)
}

pub unsafe fn app_indicator_get_icon(self_: *mut AppIndicator) -> *const gchar {
  let f = LIB
    .get::<unsafe extern "C" fn(*mut AppIndicator) -> *const gchar>(b"app_indicator_get_icon\0")
    .expect(
      "Can't get the extern function. This shouldn't happen unless the linked library is wrong.",
    );
  f(self_)
}

pub unsafe fn app_indicator_get_icon_desc(self_: *mut AppIndicator) -> *const gchar {
  let f = LIB
    .get::<unsafe extern "C" fn(*mut AppIndicator) -> *const gchar>(
      b"app_indicator_get_icon_desc\0",
    )
    .expect(
      "Can't get the extern function. This shouldn't happen unless the linked library is wrong.",
    );
  f(self_)
}

pub unsafe fn app_indicator_get_icon_theme_path(self_: *mut AppIndicator) -> *const gchar {
  let f = LIB
    .get::<unsafe extern "C" fn(*mut AppIndicator) -> *const gchar>(
      b"app_indicator_get_icon_theme_path\0",
    )
    .expect(
      "Can't get the extern function. This shouldn't happen unless the linked library is wrong.",
    );
  f(self_)
}

pub unsafe fn app_indicator_get_attention_icon(self_: *mut AppIndicator) -> *const gchar {
  let f = LIB
    .get::<unsafe extern "C" fn(*mut AppIndicator) -> *const gchar>(
      b"app_indicator_get_attention_icon\0",
    )
    .expect(
      "Can't get the extern function. This shouldn't happen unless the linked library is wrong.",
    );
  f(self_)
}

pub unsafe fn app_indicator_get_attention_icon_desc(self_: *mut AppIndicator) -> *const gchar {
  let f = LIB
    .get::<unsafe extern "C" fn(*mut AppIndicator) -> *const gchar>(
      b"app_indicator_get_attention_icon_desc\0",
    )
    .expect(
      "Can't get the extern function. This shouldn't happen unless the linked library is wrong.",
    );
  f(self_)
}

pub unsafe fn app_indicator_get_title(self_: *mut AppIndicator) -> *const gchar {
  let f = LIB
    .get::<unsafe extern "C" fn(*mut AppIndicator) -> *const gchar>(b"app_indicator_get_title\0")
    .expect(
      "Can't get the extern function. This shouldn't happen unless the linked library is wrong.",
    );
  f(self_)
}

pub unsafe fn app_indicator_get_menu(self_: *mut AppIndicator) -> *mut GtkMenu {
  let f = LIB
    .get::<unsafe extern "C" fn(*mut AppIndicator) -> *mut GtkMenu>(b"app_indicator_get_menu\0")
    .expect(
      "Can't get the extern function. This shouldn't happen unless the linked library is wrong.",
    );
  f(self_)
}

pub unsafe fn app_indicator_get_label(self_: *mut AppIndicator) -> *const gchar {
  let f = LIB
    .get::<unsafe extern "C" fn(*mut AppIndicator) -> *const gchar>(b"app_indicator_get_label\0")
    .expect(
      "Can't get the extern function. This shouldn't happen unless the linked library is wrong.",
    );
  f(self_)
}

pub unsafe fn app_indicator_get_label_guide(self_: *mut AppIndicator) -> *const gchar {
  let f = LIB
    .get::<unsafe extern "C" fn(*mut AppIndicator) -> *const gchar>(
      b"app_indicator_get_label_guide\0",
    )
    .expect(
      "Can't get the extern function. This shouldn't happen unless the linked library is wrong.",
    );
  f(self_)
}

pub unsafe fn app_indicator_get_ordering_index(self_: *mut AppIndicator) -> guint32 {
  let f = LIB
    .get::<unsafe extern "C" fn(*mut AppIndicator) -> guint32>(
      b"app_indicator_get_ordering_index\0",
    )
    .expect(
      "Can't get the extern function. This shouldn't happen unless the linked library is wrong.",
    );
  f(self_)
}

pub unsafe fn app_indicator_get_secondary_activate_target(
  self_: *mut AppIndicator,
) -> *mut GtkWidget {
  let f = LIB
    .get::<unsafe extern "C" fn(*mut AppIndicator) -> *mut GtkWidget>(
      b"app_indicator_get_secondary_activate_target\0",
    )
    .expect(
      "Can't get the extern function. This shouldn't happen unless the linked library is wrong.",
    );
  f(self_)
}

pub unsafe fn app_indicator_build_menu_from_desktop(
  self_: *mut AppIndicator,
  desktop_file: *const gchar,
  desktop_profile: *const gchar,
) {
  let f = LIB
    .get::<unsafe extern "C" fn(*mut AppIndicator, *const gchar, *const gchar)>(
      b"app_indicator_build_menu_from_desktop\0",
    )
    .expect(
      "Can't get the extern function. This shouldn't happen unless the linked library is wrong.",
    );
  f(self_, desktop_file, desktop_profile)
}
