// Take a look at the license at the top of the repository in the LICENSE file.

#![cfg_attr(docsrs, feature(doc_cfg))]
#![allow(clippy::missing_safety_doc)]
#![allow(clippy::upper_case_acronyms)]
#![allow(clippy::wrong_self_convention)]
#![doc = include_str!("../README.md")]

pub use cairo;
pub use ffi;
pub use gdk_pixbuf;
pub use gio;
pub use glib;
pub use pango;

#[macro_use]
mod rt;
#[macro_use]
mod event;

#[allow(clippy::type_complexity)]
#[allow(unused_imports)]
mod auto;

pub mod prelude;

pub use self::auto::functions::*;
pub use crate::auto::*;

mod atom;
mod cairo_interaction;
mod change_data;
mod device;
mod device_manager;
mod display;
mod drag_context;
mod event_button;
mod event_configure;
mod event_crossing;
mod event_dnd;
mod event_expose;
mod event_focus;
mod event_grab_broken;
mod event_key;
mod event_motion;
mod event_owner_change;
mod event_pad_axis;
mod event_pad_button;
mod event_pad_group_mode;
mod event_property;
mod event_proximity;
mod event_scroll;
mod event_selection;
mod event_setting;
mod event_touch;
mod event_touchpad_pinch;
mod event_touchpad_swipe;
mod event_visibility;
mod event_window_state;
mod frame_clock;
mod frame_timings;
mod functions;
mod geometry;
mod keymap;
mod keymap_key;
pub mod keys;
mod rectangle;
mod rgba;
mod screen;
mod time_coord;
mod visual;
mod window;

pub use ffi::GdkColor as Color;

pub use self::rt::{init, set_initialized};

pub use crate::atom::Atom;
pub use crate::atom::NONE as ATOM_NONE;
pub use crate::atom::SELECTION_CLIPBOARD;
pub use crate::atom::SELECTION_PRIMARY;
pub use crate::atom::SELECTION_SECONDARY;
pub use crate::atom::SELECTION_TYPE_ATOM;
pub use crate::atom::SELECTION_TYPE_BITMAP;
pub use crate::atom::SELECTION_TYPE_COLORMAP;
pub use crate::atom::SELECTION_TYPE_DRAWABLE;
pub use crate::atom::SELECTION_TYPE_INTEGER;
pub use crate::atom::SELECTION_TYPE_PIXMAP;
pub use crate::atom::SELECTION_TYPE_STRING;
pub use crate::atom::SELECTION_TYPE_WINDOW;
pub use crate::atom::TARGET_BITMAP;
pub use crate::atom::TARGET_COLORMAP;
pub use crate::atom::TARGET_DRAWABLE;
pub use crate::atom::TARGET_PIXMAP;
pub use crate::atom::TARGET_STRING;
pub use crate::change_data::ChangeData;
pub use crate::display::Backend;
pub use crate::event::{Event, FromEvent};
pub use crate::event_button::EventButton;
pub use crate::event_configure::EventConfigure;
pub use crate::event_crossing::EventCrossing;
pub use crate::event_dnd::EventDND;
pub use crate::event_expose::EventExpose;
pub use crate::event_focus::EventFocus;
pub use crate::event_grab_broken::EventGrabBroken;
pub use crate::event_key::EventKey;
pub use crate::event_motion::EventMotion;
pub use crate::event_owner_change::EventOwnerChange;
pub use crate::event_property::EventProperty;
pub use crate::event_proximity::EventProximity;
pub use crate::event_scroll::EventScroll;
pub use crate::event_selection::EventSelection;
pub use crate::event_setting::EventSetting;
pub use crate::event_touch::EventTouch;
pub use crate::event_visibility::EventVisibility;
pub use crate::event_window_state::EventWindowState;
pub use crate::functions::*;
pub use crate::geometry::Geometry;
pub use crate::keymap_key::KeymapKey;
pub use crate::time_coord::TimeCoord;
pub use crate::window::WindowAttr;
pub use event_pad_axis::EventPadAxis;
pub use event_pad_button::EventPadButton;
pub use event_pad_group_mode::EventPadGroupMode;
pub use event_touchpad_pinch::EventTouchpadPinch;
pub use event_touchpad_swipe::EventTouchpadSwipe;

#[allow(non_camel_case_types)]
pub type key = i32;

/// The primary button. This is typically the left mouse button, or the right button in a left-handed setup.
#[doc(alias = "GDK_BUTTON_PRIMARY")]
pub const BUTTON_PRIMARY: u32 = ffi::GDK_BUTTON_PRIMARY as u32;

/// The middle button.
#[doc(alias = "GDK_BUTTON_MIDDLE")]
pub const BUTTON_MIDDLE: u32 = ffi::GDK_BUTTON_MIDDLE as u32;

/// The secondary button. This is typically the right mouse button, or the left button in a left-handed setup.
#[doc(alias = "GDK_BUTTON_SECONDARY")]
pub const BUTTON_SECONDARY: u32 = ffi::GDK_BUTTON_SECONDARY as u32;

// Used as the return value for stopping the propagation of an event handler.
#[doc(alias = "GDK_EVENT_STOP")]
pub const EVENT_STOP: u32 = ffi::GDK_EVENT_STOP as u32;

// Used as the return value for continuing the propagation of an event handler.
#[doc(alias = "GDK_EVENT_PROPAGATE")]
pub const EVENT_PROPAGATE: u32 = ffi::GDK_EVENT_PROPAGATE as u32;
