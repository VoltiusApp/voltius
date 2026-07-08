// Take a look at the license at the top of the repository in the LICENSE file.

pub mod application;
pub mod application_window;
pub mod bin;
pub mod box_;
pub mod button;
pub mod cell_renderer;
pub mod cell_renderer_accel;
pub mod cell_renderer_combo;
pub mod cell_renderer_pixbuf;
pub mod cell_renderer_progress;
pub mod cell_renderer_spin;
pub mod cell_renderer_spinner;
pub mod cell_renderer_text;
pub mod cell_renderer_toggle;
pub mod container;
pub mod dialog;
pub mod drawing_area;
pub mod entry;
pub mod event_box;
pub mod fixed;
pub mod header_bar;
pub mod icon_view;
pub mod list_box;
pub mod list_box_row;
pub mod menu_button;
#[cfg(gdk_backend = "x11")]
pub mod plug;
pub mod scrolled_window;
#[cfg(gdk_backend = "x11")]
pub mod socket;
pub mod stack;
pub mod toggle_button;
pub mod tree_view;
pub mod widget;
pub mod window;

pub mod prelude {
    #[doc(hidden)]
    pub use gio::subclass::prelude::*;
    #[doc(hidden)]
    pub use glib::subclass::prelude::*;

    pub use super::application::{GtkApplicationImpl, GtkApplicationImplExt};
    pub use super::application_window::ApplicationWindowImpl;
    pub use super::bin::BinImpl;
    pub use super::box_::BoxImpl;
    pub use super::button::ButtonImpl;
    pub use super::cell_renderer::{CellRendererImpl, CellRendererImplExt};
    pub use super::cell_renderer_accel::{CellRendererAccelImpl, CellRendererAccelImplExt};
    pub use super::cell_renderer_combo::CellRendererComboImpl;
    pub use super::cell_renderer_pixbuf::CellRendererPixbufImpl;
    pub use super::cell_renderer_progress::CellRendererProgressImpl;
    pub use super::cell_renderer_spin::CellRendererSpinImpl;
    pub use super::cell_renderer_spinner::CellRendererSpinnerImpl;
    pub use super::cell_renderer_text::{CellRendererTextImpl, CellRendererTextImplExt};
    pub use super::cell_renderer_toggle::{CellRendererToggleImpl, CellRendererToggleImplExt};
    pub use super::container::{ContainerClassSubclassExt, ContainerImpl, ContainerImplExt};
    pub use super::dialog::{DialogImpl, DialogImplExt};
    pub use super::drawing_area::DrawingAreaImpl;
    pub use super::entry::{EntryImpl, EntryImplExt};
    pub use super::event_box::EventBoxImpl;
    pub use super::fixed::FixedImpl;
    pub use super::header_bar::HeaderBarImpl;
    pub use super::icon_view::{IconViewImpl, IconViewImplExt};
    pub use super::list_box::{ListBoxImpl, ListBoxImplExt};
    pub use super::list_box_row::{ListBoxRowImpl, ListBoxRowImplExt};
    pub use super::menu_button::MenuButtonImpl;
    #[cfg(gdk_backend = "x11")]
    pub use super::plug::{PlugImpl, PlugImplExt};
    pub use super::scrolled_window::{ScrolledWindowImpl, ScrolledWindowImplExt};
    #[cfg(gdk_backend = "x11")]
    pub use super::socket::{SocketImpl, SocketImplExt};
    pub use super::stack::StackImpl;
    pub use super::toggle_button::ToggleButtonImpl;
    pub use super::tree_view::TreeViewImpl;
    pub use super::widget::{
        CompositeTemplate, TemplateChild, WidgetClassSubclassExt, WidgetImpl, WidgetImplExt,
    };
    pub use super::window::{WindowImpl, WindowImplExt};
}
