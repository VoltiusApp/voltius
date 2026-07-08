// Take a look at the license at the top of the repository in the LICENSE file.

#![allow(clippy::needless_doctest_main)]
#![allow(clippy::upper_case_acronyms)]
#![allow(clippy::wrong_self_convention)]
#![doc = include_str!("../README.md")]
#![allow(clippy::type_complexity)]
#![allow(clippy::derived_hash_with_manual_eq)]
#![allow(clippy::too_many_arguments)]
#![allow(clippy::missing_safety_doc)]
#![allow(clippy::new_without_default)]
#![cfg_attr(docsrs, feature(doc_cfg))]

pub use ffi;
// Re-export gtk dependencies
pub use atk;
pub use cairo;
pub use gdk;
pub use gdk_pixbuf;
pub use gio;
pub use glib;
pub use pango;

#[doc(hidden)]
pub use field_offset::*;
#[doc(hidden)]
pub use gtk3_macros::*;

pub mod xlib;

#[doc(alias = "GTK_STYLE_PROVIDER_PRIORITY_FALLBACK")]
pub const STYLE_PROVIDER_PRIORITY_FALLBACK: u32 = ffi::GTK_STYLE_PROVIDER_PRIORITY_FALLBACK as u32;
#[doc(alias = "GTK_STYLE_PROVIDER_PRIORITY_THEME")]
pub const STYLE_PROVIDER_PRIORITY_THEME: u32 = ffi::GTK_STYLE_PROVIDER_PRIORITY_THEME as u32;
#[doc(alias = "GTK_STYLE_PROVIDER_PRIORITY_SETTINGS")]
pub const STYLE_PROVIDER_PRIORITY_SETTINGS: u32 = ffi::GTK_STYLE_PROVIDER_PRIORITY_SETTINGS as u32;
#[doc(alias = "GTK_STYLE_PROVIDER_PRIORITY_APPLICATION")]
pub const STYLE_PROVIDER_PRIORITY_APPLICATION: u32 =
    ffi::GTK_STYLE_PROVIDER_PRIORITY_APPLICATION as u32;
#[doc(alias = "GTK_STYLE_PROVIDER_PRIORITY_USER")]
pub const STYLE_PROVIDER_PRIORITY_USER: u32 = ffi::GTK_STYLE_PROVIDER_PRIORITY_USER as u32;

#[macro_use]
mod rt;

#[cfg(test)]
pub(crate) static TEST_THREAD_WORKER: glib::once_cell::sync::Lazy<glib::ThreadPool> =
    glib::once_cell::sync::Lazy::new(|| {
        let pool = glib::ThreadPool::exclusive(1).unwrap();
        pool.push(move || {
            crate::init().expect("Tests failed to initialize gtk");
        })
        .expect("Failed to schedule a test call");
        pool
    });

#[allow(clippy::let_and_return)]
#[allow(clippy::many_single_char_names)]
#[allow(clippy::wrong_self_convention)]
#[allow(clippy::clone_on_copy)]
#[allow(unused_imports)]
mod auto;

mod accel_group;
mod app_chooser;
mod application;
mod application_window;
mod border;
mod buildable;
mod builder;
mod cell_renderer_pixbuf;
mod clipboard;
mod color_button;
mod color_chooser;
mod combo_box;
mod container;
mod dialog;
mod drag_context;
mod entry;
mod entry_buffer;
mod entry_completion;
mod enums;
mod file_chooser;
mod file_chooser_dialog;
mod file_filter_info;
mod fixed;
mod flow_box;
mod functions;
#[cfg(feature = "v3_24")]
mod gesture_stylus;
mod im_context_simple;
mod image;
mod invisible;
mod list_box;
mod list_store;
mod menu;
mod message_dialog;
mod native_dialog;
mod notebook;
mod pad_action_entry;
mod pad_controller;
mod page_range;
mod print_operation;
mod print_settings;
mod radio_button;
mod radio_menu_item;
mod radio_tool_button;
mod recent_chooser_dialog;
mod recent_data;
mod requisition;
mod response_type;
mod selection_data;
mod signal;
mod stack_switcher;
mod style_context;
mod switch;
mod target_entry;
mod target_list;
mod text_buffer;
mod text_iter;
mod tree_model_filter;
mod tree_path;
mod tree_row_reference;
mod tree_sortable;
mod tree_store;
mod tree_view_column;
mod widget;

#[macro_use]
pub mod subclass;

pub mod builders;
pub mod prelude;

pub use crate::auto::functions::*;
pub use crate::auto::*;
pub use crate::rt::*;
pub use crate::signal::*;

pub use gdk::Rectangle as Allocation;
pub use gdk::Rectangle;

pub use crate::app_chooser::AppChooser;
pub use crate::border::Border;
pub use crate::entry_buffer::EntryBuffer;
pub use crate::file_filter_info::FileFilterInfo;
pub use crate::page_range::PageRange;
pub use crate::recent_data::RecentData;
pub use crate::requisition::Requisition;
pub use crate::response_type::ResponseType;
pub use crate::target_entry::TargetEntry;
pub use crate::tree_sortable::SortColumn;
pub use crate::widget::TickCallbackId;
pub use functions::*;
pub use pad_action_entry::PadActionEntry;
